# Headless deployment option. The desktop installers are the recommended way to
# run this; use Docker only when you want the oracle on a server, in which case
# camera scanning is unavailable and you must supply the UR data another way.

FROM python:3.12-alpine

WORKDIR /app

COPY SimpleJadePinServer.py requirements.txt /app/
COPY web/ /app/web/

# wallycore is hash-pinned: a substituted artifact fails the build.
RUN pip install --no-cache-dir --require-hashes -r requirements.txt

EXPOSE 4443

ENTRYPOINT ["python3", "/app/SimpleJadePinServer.py"]
