import argparse
import os

from .config import Settings
from .service import Service


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", default=os.environ.get("ATLAS_JOB_ID"))
    args = parser.parse_args()
    if not args.job:
        parser.error("--job or ATLAS_JOB_ID is required")
    service = Service(Settings())
    service.run_job(args.job)
    if service.required("IndexJob", args.job)["state"] == "failed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
