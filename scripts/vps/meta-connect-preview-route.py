#!/usr/bin/env python3
"""Install or remove only the isolated Meta-connect preview route."""
import argparse
import copy
import datetime
import json
import re
from pathlib import Path
import subprocess

ROUTE_ID = "blockwise-meta-connect-preview"
CONTAINER = "blockwise-product-product-caddy-1"
PATHS = ["/meta-connect-preview", "/meta-connect-preview/*"]


def router_config():
    return json.loads(subprocess.check_output([
        "docker", "exec", CONTAINER, "wget", "-qO-", "http://127.0.0.1:2019/config/"
    ]))


def preview_route(upstream: str):
    return {
        "@id": ROUTE_ID,
        "match": [{"host": ["blockwise.sale"], "path": PATHS}],
        "handle": [{"handler": "subroute", "routes": [
            {"handle": [{"handler": "headers", "response": {"set": {
                "X-Robots-Tag": ["noindex, nofollow, noarchive"],
                "Cache-Control": ["no-store"],
            }}}]},
            {"match": [{"method": ["GET", "HEAD"]}], "handle": [{
                "handler": "reverse_proxy",
                "upstreams": [{"dial": upstream}],
                "headers": {"request": {"delete": ["Cookie", "Authorization"]}},
            }], "terminal": True},
            {"handle": [{"handler": "static_response", "status_code": 405}]},
        ]}],
        "terminal": True,
    }


def require_known_router(config: dict):
    try:
        routes = config["apps"]["http"]["servers"]["srv0"]["routes"]
    except (KeyError, TypeError) as error:
        raise SystemExit("Refusing unknown router structure") from error
    if not isinstance(routes, list) or not any(
        "blockwise.sale" in match.get("host", [])
        for route in routes
        for match in route.get("match", [])
    ):
        raise SystemExit("Refusing unknown router: expected Blockwise host route")
    if sum(route.get("@id") == ROUTE_ID for route in routes) > 1:
        raise SystemExit("Refusing router with duplicate Meta-connect preview routes")
    return routes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--remove", action="store_true")
    parser.add_argument("--upstream", default="blockwise-meta-connect-preview:3000")
    args = parser.parse_args()
    if not re.fullmatch(r"blockwise-meta-connect-preview(?:-[a-f0-9]{8,40})?:3000", args.upstream):
        raise SystemExit("Only the isolated Meta-connect preview upstream is allowed")

    original = router_config()
    original_routes = require_known_router(original)
    updated = copy.deepcopy(original)
    routes = [route for route in original_routes if route.get("@id") != ROUTE_ID]
    if not args.remove:
        routes.insert(0, preview_route(args.upstream))
    updated["apps"]["http"]["servers"]["srv0"]["routes"] = routes

    if original == updated:
        print("Meta-connect preview route already matches.")
        return
    if not args.apply:
        print("Validated Meta-connect preview-only route update; pass --apply to load it.")
        return
    if router_config() != original:
        raise SystemExit("Router changed concurrently; inspect before retrying")

    backup = Path("/srv/blockwise/previews/meta-connect")
    backup.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    (backup / f"router-before-{stamp}.json").write_text(json.dumps(original))
    subprocess.run([
        "docker", "exec", "-i", CONTAINER, "wget", "-qO-", "--header=Content-Type: application/json",
        "--post-file=/dev/stdin", "http://127.0.0.1:2019/load",
    ], input=json.dumps(updated).encode(), check=True)
    if router_config() != updated:
        raise SystemExit("Loaded config differs: inspect router before continuing")
    print("Removed Meta-connect preview route." if args.remove else "Installed Meta-connect preview route; production routes preserved.")


if __name__ == "__main__":
    main()
