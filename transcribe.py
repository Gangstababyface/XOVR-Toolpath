#!/usr/bin/env python3
"""
Tutorial Transcription Tool
Transcribes video/audio files using Faster-Whisper (large-v3 or large-v3-turbo).
Outputs plain text, timestamped markdown, and SRT subtitle formats.

Requirements:
    pip install faster-whisper

Usage:
    python transcribe.py recording.mp4
    python transcribe.py recording.mp4 --model large-v3-turbo
    python transcribe.py recording.mp4 --formats txt md srt
    python transcribe.py ./recordings/        # batch mode (all media files in folder)
"""

import argparse
import sys
import time
from pathlib import Path

from faster_whisper import WhisperModel

MEDIA_EXTENSIONS = {
    ".mp4", ".mkv", ".avi", ".mov", ".webm",  # video
    ".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aac",  # audio
}


def format_timestamp(seconds: float) -> str:
    """Convert seconds to HH:MM:SS format."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def format_srt_timestamp(seconds: float) -> str:
    """Convert seconds to SRT timestamp format (HH:MM:SS,mmm)."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def transcribe_file(filepath: Path, model: WhisperModel) -> list[dict]:
    """Transcribe a single file and return segments."""
    print(f"\nTranscribing: {filepath.name}")
    start_time = time.time()

    segments, info = model.transcribe(
        str(filepath),
        language="en",
        beam_size=5,
        vad_filter=True,           # filters out silence
        vad_parameters=dict(
            min_silence_duration_ms=500,
            speech_pad_ms=300,
        ),
    )

    results = []
    for segment in segments:
        results.append({
            "start": segment.start,
            "end": segment.end,
            "text": segment.text.strip(),
        })
        # Print progress as segments come in
        print(f"  [{format_timestamp(segment.start)}] {segment.text.strip()}")

    elapsed = time.time() - start_time
    duration = results[-1]["end"] if results else 0
    ratio = duration / elapsed if elapsed > 0 else 0
    print(f"  Done: {elapsed:.1f}s elapsed | {duration:.0f}s audio | {ratio:.1f}x realtime")

    return results


def merge_short_segments(segments: list[dict], min_duration: float = 3.0) -> list[dict]:
    """Merge very short segments together for cleaner paragraph output."""
    if not segments:
        return segments

    merged = [segments[0].copy()]
    for seg in segments[1:]:
        prev = merged[-1]
        gap = seg["start"] - prev["end"]
        combined_duration = seg["end"] - prev["start"]

        # Merge if gap is small and combined duration is reasonable
        if gap < 1.0 and combined_duration < 30.0:
            prev["end"] = seg["end"]
            prev["text"] += " " + seg["text"]
        else:
            merged.append(seg.copy())

    return merged


def write_txt(segments: list[dict], output_path: Path):
    """Write plain text transcript (no timestamps, paragraph-grouped)."""
    merged = merge_short_segments(segments)

    paragraphs = []
    current_paragraph = []
    last_end = 0

    for seg in merged:
        gap = seg["start"] - last_end
        # Start new paragraph on longer pauses (likely new thought/topic)
        if gap > 4.0 and current_paragraph:
            paragraphs.append(" ".join(current_paragraph))
            current_paragraph = []
        current_paragraph.append(seg["text"])
        last_end = seg["end"]

    if current_paragraph:
        paragraphs.append(" ".join(current_paragraph))

    output_path.write_text("\n\n".join(paragraphs), encoding="utf-8")
    print(f"  Saved: {output_path}")


def write_md(segments: list[dict], output_path: Path, title: str = ""):
    """Write timestamped markdown transcript."""
    merged = merge_short_segments(segments)
    lines = []

    if title:
        lines.append(f"# {title}\n")

    for seg in merged:
        ts = format_timestamp(seg["start"])
        lines.append(f"**[{ts}]** {seg['text']}\n")

    output_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"  Saved: {output_path}")


def write_srt(segments: list[dict], output_path: Path):
    """Write SRT subtitle file."""
    lines = []
    for i, seg in enumerate(segments, 1):
        start_ts = format_srt_timestamp(seg["start"])
        end_ts = format_srt_timestamp(seg["end"])
        lines.append(f"{i}")
        lines.append(f"{start_ts} --> {end_ts}")
        lines.append(seg["text"])
        lines.append("")

    output_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"  Saved: {output_path}")


def get_media_files(path: Path) -> list[Path]:
    """Get list of media files from a path (single file or directory)."""
    if path.is_file():
        return [path]
    elif path.is_dir():
        files = sorted(
            f for f in path.iterdir()
            if f.suffix.lower() in MEDIA_EXTENSIONS
        )
        if not files:
            print(f"No media files found in {path}")
            sys.exit(1)
        print(f"Found {len(files)} media file(s) in {path}")
        return files
    else:
        print(f"Path not found: {path}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Transcribe tutorial recordings using Faster-Whisper"
    )
    parser.add_argument(
        "input",
        type=Path,
        help="Media file or directory of media files to transcribe",
    )
    parser.add_argument(
        "--model",
        default="large-v3",
        choices=["large-v3", "large-v3-turbo", "medium", "small"],
        help="Whisper model to use (default: large-v3)",
    )
    parser.add_argument(
        "--formats",
        nargs="+",
        default=["txt", "md", "srt"],
        choices=["txt", "md", "srt"],
        help="Output formats (default: all three)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Output directory (default: same directory as input file)",
    )

    args = parser.parse_args()

    # Load model once
    print(f"Loading model: {args.model} ...")
    model = WhisperModel(args.model, device="cuda", compute_type="float16")
    print("Model loaded.\n")

    files = get_media_files(args.input)

    for filepath in files:
        segments = transcribe_file(filepath, model)

        if not segments:
            print(f"  No speech detected in {filepath.name}")
            continue

        out_dir = args.output_dir or filepath.parent
        out_dir.mkdir(parents=True, exist_ok=True)
        stem = filepath.stem

        print(f"\n  Writing output files:")
        if "txt" in args.formats:
            write_txt(segments, out_dir / f"{stem}.txt")
        if "md" in args.formats:
            write_md(segments, out_dir / f"{stem}.md", title=stem)
        if "srt" in args.formats:
            write_srt(segments, out_dir / f"{stem}.srt")

    print("\nAll done.")


if __name__ == "__main__":
    main()
