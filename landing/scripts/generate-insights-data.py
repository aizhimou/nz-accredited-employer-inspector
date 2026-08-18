#!/usr/bin/env python3
"""Build the landing-page insights dataset from the prepared official import."""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import date
import json
from pathlib import Path
import sqlite3


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_IMPORT = ROOT / "api/.generated/official-employer-import.sql"
DEFAULT_OUTPUT = ROOT / "landing/src/data/insights.json"
MIGRATIONS = (
    ROOT / "api/migrations/0001_initial_schema.sql",
    ROOT / "api/migrations/0002_canonical_employers_and_platform_associations.sql",
    ROOT / "api/migrations/0005_official_employer_imports.sql",
)

CANONICAL_REGIONS = (
    "Northland",
    "Auckland",
    "Waikato",
    "Bay of Plenty",
    "Gisborne",
    "Hawke's Bay",
    "Taranaki",
    "Manawatu-Whanganui",
    "Wellington",
    "Tasman",
    "Nelson",
    "Marlborough",
    "West Coast",
    "Canterbury",
    "Otago",
    "Southland",
)
UNKNOWN_REGION = "Unknown / other"

REGION_ALIASES = {region.casefold(): region for region in CANONICAL_REGIONS}
REGION_ALIASES.update(
    {
        "whangarie": "Northland",
        "wellsford": "Auckland",
        "waitakere": "Auckland",
        "wairarapa": "Wellington",
        "waimauku": "Auckland",
        "taupo": "Waikato",
        "tauranga": "Bay of Plenty",
        "stratford": "Taranaki",
        "south canterbury": "Canterbury",
        "rodney": "Auckland",
        "palmerston north": "Manawatu-Whanganui",
        "palmerston": "Manawatu-Whanganui",
        "papatoetoe": "Auckland",
        "otorohanga": "Waikato",
        "new plymouth": "Taranaki",
        "manurewa": "Auckland",
        "kapiti": "Wellington",
        "hamilton": "Waikato",
        "christchurch": "Canterbury",
    }
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--import-sql", type=Path, default=DEFAULT_IMPORT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def normalise_region(value: str | None) -> str:
    if value is None:
        return UNKNOWN_REGION
    return REGION_ALIASES.get(value.strip().casefold(), UNKNOWN_REGION)


def expiry_bucket(expiry: date, snapshot: date) -> str:
    days = (expiry - snapshot).days
    if days < 0:
        return "past"
    if days < 30:
        return "0-29"
    if days < 90:
        return "30-89"
    if days < 180:
        return "90-179"
    if days < 365:
        return "180-364"
    return "365+"


def compact_cube(
    counter: Counter[tuple[str, ...]], indexes: tuple[dict[str, int], ...]
) -> list[list[int]]:
    return [
        [*(index[value] for index, value in zip(indexes, key, strict=True)), count]
        for key, count in sorted(counter.items())
    ]


def main() -> None:
    args = parse_args()
    connection = sqlite3.connect(":memory:")
    for migration in MIGRATIONS:
        connection.executescript(migration.read_text(encoding="utf-8"))
    connection.executescript(args.import_sql.read_text(encoding="utf-8"))

    snapshot_row = connection.execute(
        """
        SELECT snapshot_date, source_filename
          FROM official_employer_imports
         WHERE status = 'ready'
         ORDER BY snapshot_date DESC
         LIMIT 1
        """
    ).fetchone()
    snapshot_value = None if snapshot_row is None else snapshot_row[0]
    if snapshot_value is None:
        raise SystemExit("The prepared import does not contain a ready snapshot")
    snapshot = date.fromisoformat(snapshot_value)

    rows = connection.execute(
        """
        SELECT region, sector, subsector, accreditation_type,
               expiry_date_of_accreditation, nzbn
          FROM official_employer_import_rows
         WHERE snapshot_date = ?
        """,
        (snapshot_value,),
    ).fetchall()

    overview: Counter[tuple[str, ...]] = Counter()
    subsectors: Counter[tuple[str, ...]] = Counter()
    region_totals: Counter[str] = Counter()
    sector_totals: Counter[str] = Counter()
    type_totals: Counter[str] = Counter()
    valid_nzbn = 0

    for raw_region, raw_sector, raw_subsector, accreditation_type, raw_expiry, nzbn in rows:
        region = normalise_region(raw_region)
        sector = raw_sector or "Not specified"
        subsector = raw_subsector or "Not specified"
        expiry = date.fromisoformat(raw_expiry[:10])
        month = expiry.strftime("%Y-%m")
        bucket = expiry_bucket(expiry, snapshot)

        overview[(region, sector, accreditation_type, month, bucket)] += 1
        subsectors[(region, sector, subsector, accreditation_type)] += 1
        region_totals[region] += 1
        sector_totals[sector] += 1
        type_totals[accreditation_type] += 1
        valid_nzbn += nzbn is not None

    regions = [
        region
        for region, _ in sorted(
            region_totals.items(), key=lambda item: (-item[1], item[0])
        )
    ]
    sectors = [
        sector
        for sector, _ in sorted(
            sector_totals.items(), key=lambda item: (-item[1], item[0])
        )
    ]
    accreditation_types = [
        accreditation_type
        for accreditation_type, _ in sorted(
            type_totals.items(), key=lambda item: (-item[1], item[0])
        )
    ]
    expiry_months = sorted({key[3] for key in overview})
    expiry_buckets = ["past", "0-29", "30-89", "90-179", "180-364", "365+"]
    subsector_names = sorted({key[2] for key in subsectors})

    def make_index(values: list[str]) -> dict[str, int]:
        return {value: index for index, value in enumerate(values)}

    region_index = make_index(regions)
    sector_index = make_index(sectors)
    type_index = make_index(accreditation_types)

    payload = {
        "meta": {
            "snapshotDate": snapshot_value,
            "source": "Immigration New Zealand",
            "sourceFilename": snapshot_row[1],
            "totalRecords": len(rows),
            "validNzbn": valid_nzbn,
            "canonicalRegionCount": len(CANONICAL_REGIONS),
            "unknownRegionRecords": region_totals[UNKNOWN_REGION],
        },
        "regions": regions,
        "sectors": sectors,
        "subsectorNames": subsector_names,
        "accreditationTypes": accreditation_types,
        "expiryMonths": expiry_months,
        "expiryBuckets": expiry_buckets,
        "overview": compact_cube(
            overview,
            (
                region_index,
                sector_index,
                type_index,
                make_index(expiry_months),
                make_index(expiry_buckets),
            ),
        ),
        "subsectors": compact_cube(
            subsectors,
            (region_index, sector_index, make_index(subsector_names), type_index),
        ),
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {len(rows):,} records as {len(payload['overview']):,} overview cells "
        f"and {len(payload['subsectors']):,} subsector cells to {args.output}"
    )


if __name__ == "__main__":
    main()
