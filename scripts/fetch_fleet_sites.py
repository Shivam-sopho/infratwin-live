"""Builds backend/app/data_static/fleet_sites.json: real bridges, tunnels and dams from Wikidata (CC0).

    python3 scripts/fetch_fleet_sites.py [--from-dir DIR]

The global portfolio view places these real structures on the globe; their health states are simulated. The
Wikidata Query Service rate-limits bursts, so queries are spaced a minute apart. With --from-dir it converts
previously saved query results (bridge.json, tunnel.json, dam.json) instead of querying.
"""

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "backend/app/data_static/fleet_sites.json"
QUERY = """SELECT ?item (SAMPLE(?l) AS ?label) (SAMPLE(?c) AS ?coord) (SAMPLE(?cl) AS ?country) (MAX(?n) AS ?links) WHERE {
  ?item wdt:P31/wdt:P279* wd:%s; wdt:P625 ?c; wikibase:sitelinks ?n.
  FILTER(?n >= %d)
  ?item rdfs:label ?l. FILTER(LANG(?l) = "en")
  OPTIONAL { ?item wdt:P17 ?co. ?co rdfs:label ?cl. FILTER(LANG(?cl) = "en") }
} GROUP BY ?item ORDER BY DESC(?links) LIMIT %d"""
KINDS = [("bridge", "Q12280", 8, 450), ("tunnel", "Q44377", 6, 120), ("dam", "Q12323", 8, 150)]
# Not working infrastructure today, so never given simulated live alerts: collapsed or demolished, ancient or
# ruined, proposed or unfinished, in active conflict zones, or not a structure at all.
EXCLUDE = {
    "Polcevera Viaduct", "Francis Scott Key Bridge", "I-35W Mississippi River bridge", "Silver Bridge", "Tappan Zee Bridge",
    "Ludendorff Bridge", "Antonivka Road Bridge", "Crimean Bridge", "Bridge of No Return", "Trajan's Bridge", "Pons Aemilius",
    "Pons Sublicius", "Bridge near Limyra", "Kazarma Mycenaean Bridge", "Euphrates Tunnel", "Katarina Elevator", "Murinsel",
    "Muntplein", "South Stack", "Grand Canyon Skywalk", "Malpasset Dam", "Vajont Dam", "Banqiao Dam", "Marib Dam",
    "Sadd el-Kafara", "Usoi Dam", "Grand Inga Dam", "Kinderdijk", "Tishrin Dam", "Kadiran Dam", "Ynys Gored Goch",
    "Helsinki-to-Tallinn Tunnel", "Japan–Korea Undersea Tunnel", "Sakhalin Tunnel", "Stad Ship Tunnel", "Operation Gold",
    "Tunnel 57", "Third Tunnel of Aggression", "Hezekiah's Tunnel", "tunnel of Eupalinos", "Crypta Neapolitana",
    "Western Wall Tunnel", "Sarajevo Tunnel", "Passetto di Borgo", "Fehmarn Belt fixed link", "Brenner Base Tunnel",
    "Semmering Base Tunnel", "Big Dig", "East Side Access", "Tower Subway",
}


def fetch(kind: str, qid: str, min_links: int, limit: int) -> dict:
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": QUERY % (qid, min_links, limit)})
    req = urllib.request.Request(url, headers={"User-Agent": "InfraTwin-Live/1.0 (structural health demo)",
                                               "Accept": "application/sparql-results+json"})
    return json.loads(urllib.request.urlopen(req, timeout=120).read())


def main() -> None:
    src = Path(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[1] == "--from-dir" else None
    sites, seen = [], set()
    for i, (kind, qid, min_links, limit) in enumerate(KINDS):
        if src:
            data = json.loads((src / f"{kind}.json").read_text())
        else:
            if i:
                time.sleep(65)
            data = fetch(kind, qid, min_links, limit)
        for row in data["results"]["bindings"]:
            q = row["item"]["value"].rsplit("/", 1)[1]
            m = re.match(r"Point\(([-\d.eE]+) ([-\d.eE]+)\)", row["coord"]["value"])
            name = row["label"]["value"]
            if q in seen or not m or name in EXCLUDE or re.search(r"\b(line|railway|station)\b", name, re.I):
                continue
            seen.add(q)
            sites.append({
                "id": q, "name": name, "kind": kind, "country": row.get("country", {}).get("value", ""),
                "lng": round(float(m.group(1)), 5), "lat": round(float(m.group(2)), 5),
                "links": int(row["links"]["value"]),
            })
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"source": "Wikidata (CC0), query in scripts/fetch_fleet_sites.py", "sites": sites},
                              separators=(",", ":")))
    print(f"{len(sites)} sites -> {OUT}")


if __name__ == "__main__":
    main()
