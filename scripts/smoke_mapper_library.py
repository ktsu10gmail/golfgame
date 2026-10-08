#!/usr/bin/env python3
"""Check local protected Mapper library; optionally export a private browser session."""
import argparse
import http.client
import json
import os
from http.cookies import SimpleCookie
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser-state', action='store_true')
    args = parser.parse_args()
    connection = http.client.HTTPConnection('127.0.0.1',8081,timeout=30)
    connection.request('GET','/api/v1/course-library/courses')
    response = connection.getresponse(); response.read()
    assert response.status == 401, 'Unauthenticated Course Library access was not denied'
    password = (ROOT/'.mapper-password').read_text().strip()
    connection.request('POST','/api/mapper/login',json.dumps({'password':password}),{'Content-Type':'application/json'})
    response = connection.getresponse(); response.read()
    assert response.status == 200, f'Login failed: {response.status}'
    cookie = response.getheader('Set-Cookie').split(';',1)[0]
    connection.request('GET','/api/v1/course-library/courses?state=NJ',headers={'Cookie':cookie})
    response=connection.getresponse(); result=json.loads(response.read())
    assert response.status == 200, f'Library request failed: {response.status}'
    print(json.dumps({'library_status':response.status,'nj_courses':result['total'],
                      'counts':result['counts'],'running':result['running']}))
    for path in ('/Courses/jetta_us_course_directory_latlon_10022026_0123pm.csv',
                 '/data/course_library.sqlite3','/Courses/reports/results.csv'):
        connection.request('GET',path)
        response=connection.getresponse(); response.read()
        assert response.status == 404, f'Private artifact publicly accessible: {path}'
    if args.browser_state:
        parsed=SimpleCookie(cookie)
        state={'cookies':[{'name':name,'value':m.value,'domain':'127.0.0.1','path':'/',
                           'expires':-1,'httpOnly':True,'secure':False,'sameSite':'Strict'}
                          for name,m in parsed.items()],'origins':[]}
        path=ROOT/'output/playwright/mapper-library-state.json'
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps(state)); os.chmod(path,0o600)
        print('Private browser state saved under output/playwright (Git-ignored).')
    else:
        connection.request('POST','/api/mapper/logout','{}',{'Cookie':cookie,'Content-Type':'application/json'})
        connection.getresponse().read()
    connection.close()


if __name__ == '__main__':
    main()
