#!/usr/bin/env python3
"""Stage a private CSV in the Mapper Course Library; never starts OSM work."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    from scripts.serve import course_library
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv', type=Path)
    parser.add_argument('--queue-limit',type=int,default=0,help='Explicitly queue up to 25 new courses; default is stage only')
    parser.add_argument('--state',default='',help='Optional state filter for explicit queueing')
    args = parser.parse_args()
    if not 0 <= args.queue_limit <= 25:
        parser.error('--queue-limit must be between 0 and 25')
    if args.csv.stat().st_size > 10 * 1024 * 1024:
        parser.error('CSV exceeds 10 MB')
    result = course_library().intake(args.csv.read_text(encoding='utf-8-sig'))
    course_library().report()
    summary = {key:value for key,value in result.items() if key != 'errors'}
    summary['invalid_rows'] = len(result['errors'])
    summary['first_errors'] = result['errors'][:5]
    if args.queue_limit:
        rows=course_library().listing(state=args.state,status='New',limit=args.queue_limit)['courses']
        summary['queue'] = course_library().queue([row['id'] for row in rows]) if rows else {'queued':0}
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
