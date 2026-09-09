#!/usr/bin/env python3
"""Install/remove only the isolated homepage preview route; never replace the app."""
import argparse
import copy
import datetime
import json
import re
from pathlib import Path
import subprocess

ROUTE_ID = "blockwise-homepage-preview"
CONTAINER = "blockwise-product-product-caddy-1"

def config():
    return json.loads(subprocess.check_output([
        "docker", "exec", CONTAINER, "wget", "-qO-", "http://127.0.0.1:2019/config/"
    ]))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--remove", action="store_true")
    parser.add_argument("--upstream", default="blockwise-homepage-preview:3000")
    args = parser.parse_args()
    if not re.fullmatch(r"blockwise-homepage-preview(?:-[a-f0-9]{8,40})?:3000", args.upstream):
        raise SystemExit("Only the isolated homepage preview upstream is allowed")
    original = config()
    updated = copy.deepcopy(original)
    server = updated["apps"]["http"]["servers"]["srv0"]
    routes = [route for route in server["routes"] if route.get("@id") != ROUTE_ID]
    if not any("blockwise.sale" in match.get("host", []) for route in routes for match in route.get("match", [])):
        raise SystemExit("Refusing unknown router: expected Blockwise host route")
    if not args.remove:
        routes.insert(0, {
            "@id": ROUTE_ID,
            "match": [{"host": ["blockwise.sale"], "path": ["/homepage-preview", "/homepage-preview/*"]}],
            "handle": [{"handler": "subroute", "routes": [
                {"handle": [{"handler": "headers", "response": {"set": {
                    "X-Robots-Tag": ["noindex, nofollow, noarchive"],
                    "Cache-Control": ["no-store"]
                }}}]},
                {"match": [{"method": ["GET", "HEAD"]}], "handle": [{
                    "handler": "reverse_proxy", "upstreams": [{"dial": args.upstream}],
                    "headers": {"request": {"delete": ["Cookie", "Authorization"]}}
                }], "terminal": True},
                {"handle": [{"handler": "static_response", "status_code": 405}]}
            ]}],
            "terminal": True
        })
    server["routes"] = routes
    if original == updated:
        print("Preview route already matches.")
        return
    if not args.apply:
        print("Validated preview-only route update; pass --apply to load it.")
        return
    if config() != original:
        raise SystemExit("Router changed concurrently; inspect before retrying")
    backup = Path("/srv/blockwise/previews/homepage")
    backup.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    (backup / f"router-before-{stamp}.json").write_text(json.dumps(original))
    subprocess.run([
        "docker", "exec", "-i", CONTAINER, "wget", "-qO-", "--header=Content-Type: application/json",
        "--post-file=/dev/stdin", "http://127.0.0.1:2019/load"
    ], input=json.dumps(updated).encode(), check=True)
    if config() != updated:
        raise SystemExit("Loaded config differs: inspect router before continuing")
    print("Removed preview route." if args.remove else "Installed preview route; production routes preserved.")

if __name__ == "__main__":
    main()
