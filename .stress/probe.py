import json, time, urllib.request, urllib.error

B = "http://localhost:3012"
NUL = chr(0)

def call(method, path, body=None, ctype="application/json", raw=None):
    data = None
    if raw is not None:
        data = raw.encode() if isinstance(raw, str) else raw
    elif body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(B + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", ctype)
    try:
        r = urllib.request.urlopen(req, timeout=15)
        return r.status, r.read()[:400].decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:400].decode("utf-8", "replace")
    except Exception as e:
        return "ERR", str(e)[:200]

print("== cold single unknown barcode (waited for CC limit) ==")
time.sleep(62)
print(call("GET", "/api/skus/9999999999999"))

print("== real null byte in measuredBy + notes ==")
print(call("POST", "/api/dims", {"skuId":"cc-2","lengthMm":300,"widthMm":200,"heightMm":100,"weightKg":1.5,"measuredBy":"a"+NUL+"b","notes":"n"+NUL+"t"}))

print("== read back stored measuredBy/notes ==")
st, bd = call("GET", "/api/dims")
try:
    for d in json.loads(bd):
        print(d["skuId"], repr(d["measuredBy"]), repr(d.get("notes")))
except Exception as e:
    print("parse note:", st, repr(bd[:120]))

print("== JSON Infinity literal (bare Infinity) ==")
print(call("POST", "/api/dims", raw='{"skuId":"cc-2","lengthMm":Infinity,"widthMm":200,"heightMm":100,"weightKg":1.5,"measuredBy":"t"}'))
