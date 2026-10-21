#!/usr/bin/env python3
"""
Export the existing remote Cloudflare D1 family-tree records to Excel.    

Output:
    scripts/data_export.xlsx

Sheets and headings:
    Main:
        person, person_full, parent, tooltip, spouse, spouse_full

    gdrives:
        description, link

    images:
        person, image

    links:
        person, link, description

Required environment variables:
    CLOUDFLARE_API_TOKEN
    CLOUDFLARE_ACCOUNT_ID

The D1 database ID is read from wrangler.toml if possible.
It can alternatively be supplied through:
    CLOUDFLARE_D1_DATABASE_ID
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

try:
    import openpyxl
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter
except ImportError:
    print("ERROR: openpyxl is not installed.")
    print("Run: pip install openpyxl")
    sys.exit(1)


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)

WRANGLER_PATH = os.path.join(ROOT_DIR, "wrangler.toml")
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "data_export.xlsx")

API_BASE = "https://api.cloudflare.com/client/v4"


def required_env(name: str) -> str:
    """Return the required environment variable or stop with a clear error."""
    value = os.environ.get(name, "").strip()

    if not value:
        print(f"ERROR: Required environment variable {name} is not set.")
        sys.exit(1)

    return value


def read_database_id() -> str:
    """
    Get the D1 database ID.

    Priority:
      1. CLOUDFLARE_D1_DATABASE_ID environment variable
      2. database_id from wrangler.toml
    """
    env_database_id = os.environ.get(
        "CLOUDFLARE_D1_DATABASE_ID", ""
    ).strip()

    if env_database_id:
        return env_database_id

    if not os.path.exists(WRANGLER_PATH):
        print(f"ERROR: Wrangler configuration not found: {WRANGLER_PATH}")
        sys.exit(1)

    with open(WRANGLER_PATH, "r", encoding="utf-8") as file:
        content = file.read()

    match = re.search(
        r'^\s*database_id\s*=\s*["\']([^"\']+)["\']',
        content,
        flags=re.MULTILINE,
    )

    if not match:
        print("ERROR: database_id was not found in wrangler.toml.")
        print(
            "Alternatively create the secret "
            "CLOUDFLARE_D1_DATABASE_ID."
        )
        sys.exit(1)

    return match.group(1).strip()


def query_d1(
    account_id: str,
    database_id: str,
    api_token: str,
    sql: str,
) -> list[dict]:
    """Execute a read-only SQL query against remote D1."""
    url = (
        f"{API_BASE}/accounts/{account_id}"
        f"/d1/database/{database_id}/query"
    )

    body = json.dumps({"sql": sql}).encode("utf-8")

    request = urllib.request.Request(
        url=url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))

    except urllib.error.HTTPError as error:
        response_text = error.read().decode("utf-8", errors="replace")
        print(f"ERROR: D1 request failed with HTTP {error.code}.")
        print(response_text)
        sys.exit(1)

    except urllib.error.URLError as error:
        print(f"ERROR: Could not contact Cloudflare D1: {error}")
        sys.exit(1)

    if not payload.get("success"):
        print("ERROR: Cloudflare returned an unsuccessful D1 response.")
        print(json.dumps(payload, indent=2))
        sys.exit(1)

    result_sets = payload.get("result", [])

    if not result_sets:
        return []

    return result_sets[0].get("results", [])


def safe_value(value):
    """Convert None to an empty Excel cell."""
    if value is None:
        return ""
    return value


def build_main_rows(
    people: list[dict],
    spouses: list[dict],
) -> list[list]:
    """
    Reconstruct the Main sheet.

    Each person gets one row. If a person has multiple spouses, additional
    rows are created with the same person fields and the next spouse.
    """
    spouses_by_person: dict[str, list[dict]] = {}

    for spouse in spouses:
        person_id = str(spouse.get("person_id") or "").strip()
        spouses_by_person.setdefault(person_id, []).append(spouse)

    main_rows = []

    for person in people:
        person_id = str(person.get("id") or "").strip()
        person_spouses = spouses_by_person.get(person_id, [])

        base_values = [
            safe_value(person.get("id")),
            safe_value(person.get("full_name")),
            safe_value(person.get("parent_id")),
            safe_value(person.get("tooltip")),
        ]

        if not person_spouses:
            main_rows.append(base_values + ["", ""])
            continue

        for spouse in person_spouses:
            main_rows.append(
                base_values
                + [
                    safe_value(spouse.get("id")),
                    safe_value(spouse.get("full_name")),
                ]
            )

    return main_rows


def make_sheet(
    workbook: Workbook,
    title: str,
    headings: list[str],
    rows: list[list],
):
    """Create and lightly format one worksheet."""
    worksheet = workbook.create_sheet(title=title)
    worksheet.append(headings)

    header_fill = PatternFill(
        fill_type="solid",
        fgColor="D9EAD3",
    )

    for cell in worksheet[1]:
        cell.font = Font(bold=True)
        cell.fill = header_fill

    for row in rows:
        worksheet.append([safe_value(value) for value in row])

    worksheet.freeze_panes = "A2"
    worksheet.auto_filter.ref = worksheet.dimensions

    for column_number, heading in enumerate(headings, start=1):
        maximum_length = len(heading)

        for row_number in range(2, worksheet.max_row + 1):
            value = worksheet.cell(
                row=row_number,
                column=column_number,
            ).value

            if value is not None:
                maximum_length = max(
                    maximum_length,
                    len(str(value)),
                )

        worksheet.column_dimensions[
            get_column_letter(column_number)
        ].width = min(maximum_length + 2, 60)


def main():
    api_token = required_env("CLOUDFLARE_API_TOKEN")
    account_id = required_env("CLOUDFLARE_ACCOUNT_ID")
    database_id = read_database_id()

    print("Reading remote D1 database...")

    people = query_d1(
        account_id,
        database_id,
        api_token,
        """
        SELECT
            id,
            full_name,
            parent_id,
            tooltip,
            image_url,
            status,
            created_at
        FROM people
        ORDER BY created_at ASC, id ASC
        """,
    )

    spouses = query_d1(
        account_id,
        database_id,
        api_token,
        """
        SELECT
            id,
            full_name,
            person_id,
            image_url
        FROM spouses
        ORDER BY id ASC
        """,
    )

    links = query_d1(
        account_id,
        database_id,
        api_token,
        """
        SELECT
            person_id,
            url,
            description
        FROM links
        ORDER BY id ASC
        """,
    )

    galleries = query_d1(
        account_id,
        database_id,
        api_token,
        """
        SELECT
            description,
            gdrive_link,
            display_order
        FROM galleries
        ORDER BY display_order ASC, id ASC
        """,
    )

    main_rows = build_main_rows(people, spouses)

    # Reconstruct the images sheet from both people and spouses.
    image_rows = []

    for person in people:
        image_url = str(person.get("image_url") or "").strip()

        if image_url:
            image_rows.append(
                [
                    safe_value(person.get("id")),
                    image_url,
                ]
            )

    for spouse in spouses:
        image_url = str(spouse.get("image_url") or "").strip()

        if image_url:
            image_rows.append(
                [
                          image_url,
                ]
            )

    link_rows = [
        [
            safe_value(row.get("person_id")),
            safe_value(row.get("url")),
            safe_value(row.get("description")),
        ]
        for row in links
    ]

    gallery_rows = [
        [
            safe_value(row.get("description")),
            safe_value(row.get("gdrive_link")),
        ]
        for row in galleries
    ]

    workbook = Workbook()

    # Remove the default worksheet.
    workbook.remove(workbook.active)

    make_sheet(
        workbook,
        "Main",
        [
            "person",
            "person_full",
            "parent",
            "tooltip",
            "spouse",
            "spouse_full",
        ],
        main_rows,
    )

    make_sheet(
        workbook,
        "gdrives",
        [
            "description",
            "link",
        ],
        gallery_rows,
    )

    make_sheet(
        workbook,
        "images",
        [
            "person",
            "image",
        ],
        image_rows,
    )

    make_sheet(
        workbook,
        "links",
        [
            "person",
            "link",
            "description",
        ],
        link_rows,
    )

    workbook.save(OUTPUT_PATH)

    print(f"Created: {OUTPUT_PATH}")
    print(f"People exported: {len(people)}")
    print(f"Spouses exported: {len(spouses)}")
    print(f"Images exported: {len(image_rows)}")
    print(f"Links exported: {len(link_rows)}")
    print(f"Galleries exported: {len(gallery_rows)}")


if __name__ == "__main__":
    main()
