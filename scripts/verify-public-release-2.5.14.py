"""Stream the public APK from outside the API and verify its exact uploaded bytes."""
import hashlib,json,time,urllib.request
url='https://github.com/aishKodes/Nazraa-Releases/releases/download/v2.5.14/Nazraa-Live-2.5.14-7426-release.apk'
expected='6b36315d3154f89c894c072acd8182a96dbc138932bb6a429184bc6d28e0b001'
started=time.monotonic();sha=hashlib.sha256();size=0
with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Nazraa-Release-Verification'}),timeout=30) as r:
 assert r.status==200
 while chunk:=r.read(2*1024*1024):
  sha.update(chunk);size+=len(chunk)
  if time.monotonic()-started>240:raise TimeoutError('PUBLIC_DOWNLOAD_TIME_BUDGET')
assert size==261459155 and sha.hexdigest()==expected,'PUBLIC_BINARY_MISMATCH'
print(json.dumps({'publicDownload':'PASS','version':'2.5.14','build':7426,'bytes':size,'sha256':sha.hexdigest(),'seconds':round(time.monotonic()-started,2)}),flush=True)
