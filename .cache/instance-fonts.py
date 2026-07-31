import json, os, sys
from multiprocessing import Pool
from fontTools import ttLib
from fontTools.varLib.instancer import instantiateVariableFont

def work(job):
    try:
        font = ttLib.TTFont(job["src"])
        if "fvar" not in font:
            return "no-fvar"
        axes = {axis.axisTag: axis.defaultValue for axis in font["fvar"].axes}
        if "wght" not in axes:
            return "no-wght"
        axes["wght"] = job["weight"]
        instantiateVariableFont(font, axes, inplace=True)
        os.makedirs(os.path.dirname(job["dest"]), exist_ok=True)
        font.save(job["dest"])
        return "ok"
    except Exception as error:
        return f"error:{error}"

jobs = json.load(open(sys.argv[1]))
failed = 0
with Pool(8) as pool:
    for index, status in enumerate(pool.imap_unordered(work, jobs)):
        if status != "ok":
            failed += 1
        if index % 250 == 0:
            print(f"{index}/{len(jobs)} instanced ({failed} failed)", flush=True)
print(f"instancing done: {len(jobs) - failed} ok, {failed} failed")
