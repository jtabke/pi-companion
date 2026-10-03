"""Link declarations from the reviewed host Pi; never install or modify that host."""
from pathlib import Path
import json
import shutil


def main():
    executable = shutil.which("pi")
    if not executable:
        raise SystemExit("Existing Pi required on PATH")
    package = next(
        (p for p in Path(executable).resolve().parents
         if (p / "package.json").is_file()),
        None,
    )
    if package is None:
        raise SystemExit("Cannot locate installed Pi package")
    meta = json.loads((package / "package.json").read_text())
    if (meta.get("name"), meta.get("version")) != ("@earendil-works/pi-coding-agent", "0.99.2"):
        raise SystemExit("Only Pi 0.99.2 reviewed; stop for version review")
    public_ai = package / "node_modules/@earendil-works/pi-ai"
    ai = json.loads((public_ai / "package.json").read_text())
    if (ai.get("name"), ai.get("version")) != ("@earendil-works/pi-ai", "0.99.2"):
        raise SystemExit("Only public pi-ai 0.99.2 reviewed")

    root = Path(__file__).resolve().parent.parent
    scope = root / "node_modules/@earendil-works"
    links = [(scope / "pi-coding-agent", package), (scope / "pi-ai", public_ai)]
    # Validate both destinations before creating either link. Existing trees are never replaced.
    for link, target in links:
        if link.is_symlink():
            if link.resolve() != target.resolve():
                raise SystemExit("Existing type link differs")
        elif link.exists():
            raise SystemExit("Refusing to replace a local package")
    scope.mkdir(exist_ok=True)
    for link, target in links:
        if not link.is_symlink():
            link.symlink_to(target, target_is_directory=True)
    print("Linked reviewed Pi 0.99.2 and pi-ai 0.99.2 declarations")


if __name__ == "__main__":
    main()
