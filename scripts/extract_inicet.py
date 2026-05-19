#!/usr/bin/env python3
import hashlib
import json
import re
from pathlib import Path

import fitz


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "neet-pg-streak"
PUBLIC = FRONTEND / "public"
PDF_DIR = Path("/Users/admin/Desktop/inicet")
OUTPUT_JSON = PUBLIC / "inicet_questions.json"
IMAGE_DIR = PUBLIC / "images" / "inicet"


QUESTION_RE = re.compile(r"(?m)^\s*Q\s*(\d+)\s*[\.)]\s*")
ANSWER_RE = re.compile(
    r"(?:Correct\s+Answer|Answer|Ans)\s*[-:\.]?\s*"
    r"(?:\(?\s*(?:Option\s*)?([A-Da-d1-4])\s*\)?[\.)]?)?"
    r"\s*([^\n]*)",
    re.IGNORECASE,
)
LETTER_OPTION_RE = re.compile(
    r"(?ms)(?:^|\n)\s*([A-D])\s*[\.)]\s*(.*?)"
    r"(?=(?:\n\s*[A-D]\s*[\.)]|\n\s*(?:Correct\s+Answer|Answer|Ans)\s*[-:\.]?|$))",
)
NUMBER_OPTION_RE = re.compile(
    r"(?ms)(?:^|\n)\s*([1-4])\s*[\.)]\s*(.*?)"
    r"(?=(?:\n\s*[1-4]\s*[\.)]|\n\s*(?:Correct\s+Answer|Answer|Ans)\s*[-:\.]?|$))",
    re.IGNORECASE,
)


def clean(value=""):
    return (
        str(value)
        .replace("\u200b", " ")
        .replace("\u200c", " ")
        .replace("\u200d", " ")
        .replace("\ufeff", " ")
        .replace("\u00a0", " ")
        .replace("​", " ")
        .replace("●", " ")
        .replace("PrepLadder", " ")
    )


def compact(value=""):
    return re.sub(r"\s+", " ", clean(value)).strip()


def subject_from_filename(path):
    name = path.stem
    replacements = [
        "Copy-of-",
        "Last-5-Year-PYQs-in-",
        "Last-5-Years-PYQs-INI-CET-",
        "Last-5-Year-PYQ- in-",
        "Last-5-year-PYQs-in-",
        "Last-5-Years-PYQs-of-INI-CET-",
        "for-INI-CET",
        "for-INICET",
        "INI-CET",
    ]
    for piece in replacements:
        name = name.replace(piece, "")
    return name.replace("-", " ").replace("  ", " ").strip() or "INI-CET"


def normalize_for_match(value):
    return re.sub(r"[^a-z0-9]+", " ", compact(value).lower()).strip()


def parse_options(segment):
    letter_matches = list(LETTER_OPTION_RE.finditer(segment))
    number_matches = list(NUMBER_OPTION_RE.finditer(segment))
    matches = letter_matches if len(letter_matches) >= 2 else number_matches
    options = {}

    for index, match in enumerate(matches[:4], start=1):
        option_text = compact(match.group(2))
        option_text = re.sub(
            r"\s*(?:Correct\s+Answer|Answer|Ans)\s*[-:\.]?.*$",
            "",
            option_text,
            flags=re.IGNORECASE,
        ).strip()
        if option_text:
            options[f"O{index}"] = option_text

    return options, matches


def parse_answer(segment, options):
    answer_match = ANSWER_RE.search(segment)
    if not answer_match:
        return ""

    marker = (answer_match.group(1) or "").upper()
    answer_text = compact(answer_match.group(2) or "")
    answer_text = re.sub(r"^[A-D1-4]\s*[\.)]\s*", "", answer_text).strip()
    normalized_answer = normalize_for_match(answer_text)

    if normalized_answer:
        for key, option in options.items():
            normalized_option = normalize_for_match(option)
            if normalized_answer and (
                normalized_answer in normalized_option
                or normalized_option in normalized_answer
            ):
                return key

    if marker:
        if marker in "ABCD":
            return f"O{'ABCD'.index(marker) + 1}"
        if marker in "1234":
            return f"O{marker}"

    return ""


def extract_page_images(page, pdf_path):
    image_paths = []
    page_dict = page.get_text("dict")
    image_index = 1
    for block in page_dict.get("blocks", []):
        if block.get("type") != 1 or not block.get("image"):
            continue

        ext = block.get("ext") or "png"
        safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", pdf_path.stem)
        image_name = f"{safe_stem}_page{page.number + 1}_img{image_index}.{ext}"
        image_path = IMAGE_DIR / image_name
        image_path.write_bytes(block["image"])
        image_paths.append(f"images/inicet/{image_name}")
        image_index += 1

    return image_paths


def question_id(source_pdf, question_no, question):
    digest = hashlib.sha1(f"{source_pdf}:{question_no}:{question}".encode()).hexdigest()[:10]
    return f"inicet-{digest}"


def parse_pdf(pdf_path):
    questions = []
    subject = subject_from_filename(pdf_path)
    with fitz.open(pdf_path) as doc:
        for page in doc:
            raw_text = clean(page.get_text("text"))
            if not raw_text.strip():
                continue

            page_images = extract_page_images(page, pdf_path)
            starts = list(QUESTION_RE.finditer(raw_text))
            for index, start in enumerate(starts):
                end = starts[index + 1].start() if index + 1 < len(starts) else len(raw_text)
                segment = raw_text[start.start() : end]
                question_no = start.group(1)
                options, option_matches = parse_options(segment)
                if len(options) < 2:
                    continue

                first_option_pos = option_matches[0].start() if option_matches else len(segment)
                question_text = compact(QUESTION_RE.sub("", segment[:first_option_pos], count=1))
                question_text = re.sub(r"^Last\s+5.*?INI-CET\s*", "", question_text, flags=re.IGNORECASE)
                answer = parse_answer(segment, options)
                if not question_text or not answer:
                    continue

                mentions_image = re.search(
                    r"\b(image|figure|shown|identify|given|marked|microscopy|x-ray|ct|mri|ecg)\b",
                    question_text,
                    re.IGNORECASE,
                )

                questions.append(
                    {
                        "id": question_id(pdf_path.name, question_no, question_text),
                        "exam": "inicet",
                        "question_no": question_no,
                        "subject": subject,
                        "topic": subject,
                        "sub_topic": "",
                        "question": question_text,
                        "options": options,
                        "answer": answer,
                        "images": page_images if mentions_image else [],
                        "source_pdf": pdf_path.name,
                        "page_number": page.number + 1,
                    }
                )

    return questions


def dedupe(questions):
    seen = set()
    unique = []
    for question in questions:
        key = normalize_for_match(
            json.dumps(
                [question["question"], question["options"], question["answer"]],
                ensure_ascii=False,
                sort_keys=True,
            )
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(question)
    return unique


def main():
    if not PDF_DIR.exists():
        raise SystemExit(f"INI-CET PDF folder not found: {PDF_DIR}")

    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    all_questions = []
    for pdf_path in sorted(PDF_DIR.glob("*.pdf")):
        extracted = parse_pdf(pdf_path)
        print(f"{pdf_path.name}: {len(extracted)} questions")
        all_questions.extend(extracted)

    all_questions = dedupe(all_questions)
    used_images = {
        image_path
        for question in all_questions
        for image_path in question.get("images", [])
    }
    for image_file in IMAGE_DIR.glob("*"):
        relative_path = f"images/inicet/{image_file.name}"
        if relative_path not in used_images:
            image_file.unlink()

    OUTPUT_JSON.write_text(json.dumps(all_questions, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(all_questions)} unique INI-CET questions to {OUTPUT_JSON}")


if __name__ == "__main__":
    main()
