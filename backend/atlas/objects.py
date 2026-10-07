import os
from pathlib import Path
from tempfile import NamedTemporaryFile

from google.cloud import storage


class LocalObjects:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, key):
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise ValueError("Invalid object key")
        return path

    def put(self, key, data, mime="application/octet-stream"):
        target = self.path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(dir=target.parent, delete=False) as tmp:
            tmp.write(data)
        os.replace(tmp.name, target)

    def get(self, key):
        return self.path(key).read_bytes()

    def download(self, key, path):
        import shutil
        shutil.copyfile(self.path(key), path)

    def upload(self, key, path, mime):
        import shutil
        target = self.path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)

    def size(self, key):
        return self.path(key).stat().st_size

    def delete(self, key):
        self.path(key).unlink(missing_ok=True)

    def read_range(self, key, start, end):
        with self.path(key).open("rb") as file:
            file.seek(start)
            return file.read(end - start + 1)


class CloudObjects:
    def __init__(self, project, bucket):
        self.bucket = storage.Client(project=project).bucket(bucket)

    def put(self, key, data, mime="application/octet-stream"):
        self.bucket.blob(key).upload_from_string(data, content_type=mime)

    def get(self, key):
        return self.bucket.blob(key).download_as_bytes()

    def download(self, key, path):
        self.bucket.blob(key).download_to_filename(str(path))

    def upload(self, key, path, mime):
        self.bucket.blob(key).upload_from_filename(str(path), content_type=mime)

    def size(self, key):
        blob = self.bucket.blob(key)
        blob.reload()
        return blob.size

    def delete(self, key):
        from google.api_core.exceptions import NotFound
        try:
            self.bucket.blob(key).delete()
        except NotFound:
            pass

    def read_range(self, key, start, end):
        return self.bucket.blob(key).download_as_bytes(start=start, end=end)

    def upload_session(self, key, mime, size, origin):
        return self.bucket.blob(key).create_resumable_upload_session(
            content_type=mime, size=size, origin=origin, timeout=60)
