"""Exports Deezer's S-KEY key detector (ICASSP 2025, MIT) to ONNX for the
analysis worker (worker/skey-worker.js). Dev-only, never shipped.

Input: the upstream code and checkpoint as fetched and hash-verified into
a local folder, SKEY_SRC_DIR (commit in PINNED_COMMIT.txt there).
Output: ../../models/skey.onnx - waveform (1, samples) float32 at 22050 Hz,
peak-normalized, in; 24 key probabilities out (upstream key_map order).

Same graph as upstream key_detection.infer_key(): VQT (99 bins from 27.5
Hz) -> crop to 84 bins -> ChromaNet. Two changes, each exactly equivalent,
needed because the legacy ONNX exporter cannot take shapes that depend on
the track length:
  - ChromaNet's blocks call layer_norm(x, x.shape[1:]) - a norm over the
    whole (channel, pitch, time) block with no learned scale. Written here
    as the same mean/variance over dims 1-3, eps 1e-5 (layer_norm's
    default);
  - after the octave pool the pitch axis is already 12 tall, so
    AdaptiveAvgPool2d((12, 1)) is just a mean over time.
The script checks the rewritten graph against the original modules before
exporting, and the ONNX file against PyTorch after.

Run with a Python that has torch, onnx and numpy:
  SKEY_SRC_DIR=<folder> python export_skey_onnx.py
"""
import os
import sys
import types

import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get("SKEY_SRC_DIR")
if not SRC:
    sys.exit("set SKEY_SRC_DIR to the folder holding the upstream skey code and checkpoint")
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "models", "skey.onnx"))
sys.path.insert(0, SRC)
_tqdm = types.ModuleType("tqdm")
_tqdm.tqdm = lambda it, **kw: it
sys.modules.setdefault("tqdm", _tqdm)
from skey.chromanet import ChromaNet  # noqa: E402
from skey.hcqt import VQT, CropCQT  # noqa: E402

def load():
    from numpy._core.multiarray import scalar as np_scalar
    allowed = [(np_scalar, "numpy.core.multiarray.scalar"), np.dtype] + \
        [type(np.dtype(t)) for t in ("float64", "float32", "int64", "int32")]
    with torch.serialization.safe_globals(allowed):
        ckpt = torch.load(os.path.join(SRC, "skey", "models", "skey.pt"), map_location="cpu", weights_only=True)
    hcqt = VQT(harmonics=[1], fmin=27.5, n_bins=99)
    net = ChromaNet(n_bins=84, n_harmonics=1, out_channels=[2, 3, 40, 40, 30, 10, 3],
                    kernels=[7, 7, 7, 7, 7, 5, 5], temperature=1)
    hcqt.load_state_dict({k.replace("hcqt.", ""): v for k, v in ckpt["stone"].items() if "hcqt" in k})
    net.load_state_dict({k.replace("chromanet.", ""): v for k, v in ckpt["stone"].items() if "chromanet" in k})
    hcqt.eval()
    net.eval()
    assert ckpt["audio"]["sr"] == 22050
    return hcqt, net

def _layer_norm(x):
    mean = x.mean(dim=(1, 2, 3), keepdim=True)
    var = ((x - mean) ** 2).mean(dim=(1, 2, 3), keepdim=True)
    return (x - mean) / torch.sqrt(var + 1e-5)

def _down(block, x):  # TimeDownsamplingBlock.forward
    return block.act(block.conv(_layer_norm(x)))

def _convnext(block, x):  # ConvNeXtBlock.forward (DropPath is identity in eval)
    inp = x
    x = _layer_norm(block.dwconv(x))
    x = x.permute(0, 2, 3, 1)
    x = block.pwconv2(block.act(block.pwconv1(x)))
    if block.gamma is not None:
        x = block.gamma * x
    return inp + x.permute(0, 3, 1, 2)

class SKey(torch.nn.Module):
    def __init__(self, hcqt, net):
        super().__init__()
        self.hcqt = hcqt
        self.net = net

    def forward(self, waveform):  # (1, samples)
        x = self.hcqt(waveform.unsqueeze(0))  # (1, 1, 99, frames)
        x = x[:, :, 0:84, :]  # CropCQT(84) with transpose 0
        n = self.net
        for convnext_block, down in zip(n.convnext_blocks, n.time_downsampling_blocks):
            x = _down(down, x)
            x = _convnext(convnext_block, x)
        x = n.octave_pool(x)  # (1, C, 12, W)
        x = x.mean(dim=3, keepdim=True)  # == AdaptiveAvgPool2d((12, 1)) since H is already 12
        x = n.classifier(x)
        x = n.batch_norm(x)
        x = n.flatten(x)
        return n.softmax(x / n.temperature)[0]

def reference(hcqt, net, wave):
    with torch.no_grad():
        return net(CropCQT(84)(hcqt(wave.unsqueeze(0)), torch.zeros(1)))[0]

if __name__ == "__main__":
    hcqt, net = load()
    model = SKey(hcqt, net).eval()
    rng = np.random.default_rng(12345)
    for seconds in (7, 30, 181):
        wave = torch.from_numpy(rng.standard_normal(22050 * seconds).astype(np.float32) * 0.1).unsqueeze(0)
        with torch.no_grad():
            diff = float((model(wave) - reference(hcqt, net, wave)).abs().max())
        assert diff < 1e-5, f"rewritten graph differs from upstream by {diff} on {seconds}s"
    print("rewritten graph == upstream graph (max abs diff < 1e-5 at 7/30/181 s)")

    dummy = torch.zeros(1, 22050 * 30)
    torch.onnx.export(model, (dummy,), OUT, input_names=["waveform"], output_names=["probs"],
                      dynamic_axes={"waveform": {1: "samples"}}, opset_version=17, dynamo=False)
    print("wrote", OUT, os.path.getsize(OUT), "bytes")

    import onnxruntime as ort
    sess = ort.InferenceSession(OUT)
    for seconds in (7, 30, 181):
        wave = rng.standard_normal(22050 * seconds).astype(np.float32) * 0.1
        got = sess.run(None, {"waveform": wave[None, :]})[0]
        want = reference(hcqt, net, torch.from_numpy(wave).unsqueeze(0)).numpy()
        diff = float(np.abs(got - want).max())
        assert diff < 1e-4 and int(got.argmax()) == int(want.argmax()), f"ONNX differs by {diff} on {seconds}s"
    print("ONNX == PyTorch (max abs diff < 1e-4, same argmax) at 7/30/181 s")
