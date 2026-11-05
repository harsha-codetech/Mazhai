"""Pulls Chennai's roads, water and places out of a Geofabrik .osm.pbf extract.

Usage: python scripts/extract_osm.py
Writes roads.ndjson, water.json and places.json into scripts/raw/chennai/.
"""
import json
from pathlib import Path

import osmium

RAW = Path(__file__).parent / 'raw' / 'chennai'
SOURCE = RAW / 'southern-zone.osm.pbf'
SOUTH, WEST, NORTH, EAST = 12.78, 80.00, 13.25, 80.35

ROADS = {
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
    'living_street', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
}
WATERWAYS = {'river', 'canal', 'drain', 'stream'}
PLACES = {'city', 'town', 'suburb', 'quarter', 'neighbourhood'}


def inside(lat, lon):
    return SOUTH <= lat <= NORTH and WEST <= lon <= EAST


def way_points(way):
    points = []
    for node in way.nodes:
        if node.location.valid():
            points.append([round(node.location.lat, 6), round(node.location.lon, 6)])
    return points


def place_kind(tags):
    if tags.get('place') in PLACES:
        return 'place'
    if tags.get('railway') == 'station':
        return 'station'
    if tags.get('amenity') in ('hospital', 'university', 'college'):
        return tags.get('amenity')
    if tags.get('shop') == 'mall':
        return 'mall'
    if tags.get('aeroway') == 'aerodrome':
        return 'airport'
    return None


def main():
    roads = 0
    polygons = []
    lines = []
    places = []

    processor = (
        osmium.FileProcessor(str(SOURCE))
        .with_locations()
        .with_areas()
        .with_filter(osmium.filter.KeyFilter('highway', 'waterway', 'natural', 'place', 'railway', 'amenity', 'shop', 'aeroway'))
    )
    with open(RAW / 'roads.ndjson', 'w', encoding='utf-8') as out:
        for obj in processor:
            tags = obj.tags
            if obj.is_node():
                kind = place_kind(tags)
                if kind and 'name' in tags and inside(obj.location.lat, obj.location.lon):
                    places.append({'name': tags['name'], 'kind': kind, 'lat': obj.location.lat, 'lon': obj.location.lon})
            elif obj.is_way():
                highway = tags.get('highway')
                waterway = tags.get('waterway')
                if highway not in ROADS and waterway not in WATERWAYS and not place_kind(tags):
                    continue
                points = way_points(obj)
                if not any(inside(*p) for p in points):
                    continue
                if highway in ROADS:
                    road = {
                        'h': highway,
                        'n': tags.get('name', ''),
                        'o': 1 if tags.get('oneway') in ('yes', '1') or tags.get('junction') == 'roundabout' else 0,
                        'b': 1 if tags.get('bridge', 'no') != 'no' else 0,
                        't': 1 if tags.get('tunnel', 'no') != 'no' or tags.get('layer', '0').startswith('-') else 0,
                        'p': points,
                    }
                    out.write(json.dumps(road, ensure_ascii=False, separators=(',', ':')) + '\n')
                    roads += 1
                elif waterway in WATERWAYS:
                    lines.append(points)
                elif 'name' in tags:
                    lat = sum(p[0] for p in points) / len(points)
                    lon = sum(p[1] for p in points) / len(points)
                    places.append({'name': tags['name'], 'kind': place_kind(tags), 'lat': lat, 'lon': lon})
            elif obj.is_area():
                if tags.get('natural') not in ('water', 'wetland'):
                    continue
                for ring in obj.outer_rings():
                    points = [[round(n.lat, 6), round(n.lon, 6)] for n in ring]
                    if any(inside(*p) for p in points):
                        polygons.append(points)

    (RAW / 'water.json').write_text(json.dumps({'polygons': polygons, 'lines': lines}), encoding='utf-8')
    (RAW / 'places.json').write_text(json.dumps(places, ensure_ascii=False), encoding='utf-8')
    print(f'roads {roads}, water polygons {len(polygons)}, water lines {len(lines)}, places {len(places)}')


if __name__ == '__main__':
    main()
