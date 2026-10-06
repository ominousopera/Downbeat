"""Every element id the panel's JavaScript looks up must exist in index.html.

A missing id is not a crash on load: getElementById returns null, and the panel
fails later, at the first property access, usually inside a click handler.

Scans every panel script (js/*.js), not just main.js. CSInterface.js and the
vendored js/lib/ are skipped.
"""
import io, os, re, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = io.open(os.path.join(HERE, "index.html"), encoding="utf-8").read()

js_dir = os.path.join(HERE, "js")
sources = {}
for name in sorted(os.listdir(js_dir)):
    if name.endswith(".js") and name != "CSInterface.js":
        sources[name] = io.open(os.path.join(js_dir, name), encoding="utf-8").read()

have = set(re.findall(r'id="([^"]+)"', html))
want = {}
for name, js in sources.items():
    for found in re.findall(r'getElementById\("([^"]+)"\)', js):
        want.setdefault(found, set()).add(name)

missing = sorted(set(want) - have)
if missing:
    sys.stderr.write("index.html is missing ids that the panel's scripts look up:\n")
    for m in missing:
        sys.stderr.write("  %s  (in %s)\n" % (m, ", ".join(sorted(want[m]))))
    sys.exit(1)

print("  %d ids referenced across %d scripts, all present" % (len(want), len(sources)))

# The hidden attribute must actually hide: css/style.css ends with a global
# [hidden] rule, which this checks for.
css = io.open(os.path.join(HERE, "css", "style.css"), encoding="utf-8").read()
css_nc = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
if not re.search(r"(^|[\s}])\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important", css_nc):
    sys.stderr.write("css/style.css has no global [hidden] { display: none !important } rule.\n"
                     "Without it any class that sets display un-hides elements marked hidden.\n")
    sys.exit(1)
print("  hidden attribute is enforced globally")
