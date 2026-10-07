class AtlasError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class Superseded(AtlasError):
    def __init__(self):
        super().__init__("This operation was superseded by a newer revision or job.", 409)
