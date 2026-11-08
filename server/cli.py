"""Transcribe a local audio file and print the note JSON the phone would get.

    python cli.py recording.m4a > notes.json
"""
import json
import sys

import pianoscribe_server as srv

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    result = srv.run_model(sys.argv[1])
    result.pop("midi_base64", None)
    json.dump(result, sys.stdout, indent=1)
