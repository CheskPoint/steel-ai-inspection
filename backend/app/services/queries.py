"""SQL-backed read models. Large inspection/report payloads stay in SQLite."""
import json

from fastapi import HTTPException


HUMAN = "('confirmed','corrected','false_positive')"
STATUS = "json_extract(i.payload,'$.review_status')"
DAY = "date(json_extract(i.payload,'$.created_at'),'+8 hours')"
FINAL_BOXES = "CASE WHEN json_type(i.payload,'$.reviewed_detections')='array' THEN json_extract(i.payload,'$.reviewed_detections') ELSE json_extract(i.payload,'$.detections') END"
JOINED = "inspections i LEFT JOIN coils c ON c.id=i.coil_id LEFT JOIN batches b ON b.id=c.batch_id"


def dates_valid(start, end):
    if start and end and start > end:
        raise HTTPException(422, "开始日期不能晚于结束日期。")


def inspection_where(query='', batch='', coil='', status='', category='', start=None, end=None, folder=None):
    dates_valid(start, end)
    clauses, params = [], []
    if query:
        clauses.append("instr(lower(COALESCE(json_extract(i.payload,'$.filename'),'') || ' ' || i.id || ' ' || COALESCE(c.code,'') || ' ' || COALESCE(b.code,'') || ' ' || COALESCE(json_extract(i.payload,'$.created_by'),'')),lower(?))>0")
        params.append(query)
    if batch:
        clauses.append('c.batch_id=?')
        params.append(batch)
    if coil:
        if coil in {'unlinked', 'unassigned'}:
            clauses.append('i.coil_id IS NULL')
        else:
            clauses.append('i.coil_id=?')
            params.append(coil)
    if status and status != 'all':
        if status == 'completed':
            clauses.append(f"{STATUS}<>'pending'")
        elif status == 'human_reviewed':
            clauses.append(f'{STATUS} IN {HUMAN}')
        else:
            clauses.append(f'{STATUS}=?')
            params.append(status)
    if category:
        clauses.append(f"EXISTS (SELECT 1 FROM json_each({FINAL_BOXES}) box WHERE json_extract(box.value,'$.class_name')=?)")
        params.append(category)
    for value, operator in ((start, '>='), (end, '<='), (folder, '=')):
        if value:
            clauses.append(f'{DAY}{operator}?')
            params.append(str(value))
    return (' WHERE ' + ' AND '.join(clauses)) if clauses else '', params


def inspection_page(conn, filters, offset, limit):
    where, params = filters
    total = conn.execute(f'SELECT COUNT(*) FROM {JOINED}{where}', params).fetchone()[0]
    items = [json.loads(row[0]) for row in conn.execute(f'SELECT i.payload FROM {JOINED}{where} ORDER BY i.rowid DESC LIMIT ? OFFSET ?', (*params, limit, offset))]
    return {'items': items, 'total': total}


def folder_page(conn, filters, offset, limit):
    where, params = filters
    grouped = f'SELECT {DAY} AS date, COUNT(*) AS total, SUM({STATUS}=\'pending\') AS pending FROM {JOINED}{where} GROUP BY {DAY}'
    total = conn.execute(f'SELECT COUNT(*) FROM ({grouped})', params).fetchone()[0]
    items = [dict(row) for row in conn.execute(grouped + ' ORDER BY date DESC LIMIT ? OFFSET ?', (*params, limit, offset))]
    return {'items': items, 'total': total}


def analytics(conn, start=None, end=None):
    where, params = inspection_where(start=start, end=end)
    counts = dict(conn.execute(f"SELECT COUNT(*) AS total, COALESCE(SUM({STATUS}='pending'),0) AS pending, COALESCE(SUM({STATUS}<>'pending'),0) AS reviewed, COALESCE(SUM({STATUS}='auto_confirmed'),0) AS autoConfirmed, COALESCE(SUM({STATUS} IN {HUMAN}),0) AS humanReviewed FROM {JOINED}{where}", params).fetchone())
    completed = where + (' AND ' if where else ' WHERE ') + f"({STATUS}='auto_confirmed' OR {STATUS} IN {HUMAN})"
    counts['classes'] = [dict(row) for row in conn.execute(f"SELECT json_extract(box.value,'$.class_name') AS name,COUNT(*) AS count,SUM({STATUS}='auto_confirmed') AS autoCount,SUM({STATUS} IN {HUMAN}) AS humanCount FROM {JOINED},json_each({FINAL_BOXES}) box{completed} GROUP BY name ORDER BY name", params)]
    counts.update(confirmedTargets=sum(row['count'] for row in counts['classes']), autoTargets=sum(row['autoCount'] for row in counts['classes']), humanTargets=sum(row['humanCount'] for row in counts['classes']))
    counts['days'] = [dict(row) for row in conn.execute(f'SELECT {DAY} AS date,COUNT(*) AS count FROM {JOINED}{where} GROUP BY {DAY} ORDER BY date', params)]
    return counts


def audit_page(conn, user, query='', actor='', action='', day=None, offset=0, limit=50):
    clauses, params = [], []
    if user['role'] != 'admin':
        clauses.append("json_extract(payload,'$.user_id')=?")
        params.append(user['id'])
    scope = (' WHERE ' + ' AND '.join(clauses)) if clauses else ''
    actions = [row[0] for row in conn.execute(f"SELECT DISTINCT json_extract(payload,'$.action') AS action FROM audit_logs{scope} ORDER BY action", params)]
    if query:
        clauses.append('instr(lower(payload),lower(?))>0')
        params.append(query)
    if actor:
        clauses.append("(json_extract(payload,'$.user_id')=? OR json_extract(payload,'$.username')=?)")
        params.extend((actor, actor))
    if action:
        clauses.append("json_extract(payload,'$.action')=?")
        params.append(action)
    if day:
        clauses.append("date(json_extract(payload,'$.created_at'),'+8 hours')=?")
        params.append(str(day))
    where = (' WHERE ' + ' AND '.join(clauses)) if clauses else ''
    total = conn.execute(f'SELECT COUNT(*) FROM audit_logs{where}', params).fetchone()[0]
    items = [json.loads(row[0]) for row in conn.execute(f'SELECT payload FROM audit_logs{where} ORDER BY rowid DESC LIMIT ? OFFSET ?', (*params, limit, offset))]
    return {'items': items, 'total': total, 'actions': actions}


def workspace_summary(conn):
    counts = dict(conn.execute(f"SELECT COUNT(*) AS inspections,COALESCE(SUM({STATUS}='pending'),0) AS pending_reviews,COALESCE(SUM({STATUS}='auto_confirmed'),0) AS auto_confirmed,COALESCE(SUM({STATUS} IN {HUMAN}),0) AS human_reviewed,COALESCE(SUM({DAY}=date('now','+8 hours')),0) AS today_inspections FROM inspections i").fetchone())
    counts['batches'] = conn.execute('SELECT COUNT(*) FROM batches').fetchone()[0]
    counts.update(dict(conn.execute("SELECT COUNT(*) AS coils,COALESCE(SUM(json_extract(payload,'$.status')='qualified'),0) AS qualified_coils,COALESCE(SUM(json_extract(payload,'$.status')='unqualified'),0) AS unqualified_coils,COALESCE(SUM(json_extract(payload,'$.status')<>'archived' AND json_type(payload,'$.judgment') IS NULL AND EXISTS(SELECT 1 FROM inspections i WHERE i.coil_id=coils.id) AND NOT EXISTS(SELECT 1 FROM inspections i WHERE i.coil_id=coils.id AND json_extract(i.payload,'$.review_status')='pending')),0) AS pending_judgments FROM coils").fetchone()))
    counts['open_alerts'] = conn.execute("SELECT COUNT(*) FROM alerts WHERE json_extract(payload,'$.status')<>'resolved'").fetchone()[0]
    per_coil = {row['coil_id']: {'total': row['total'], 'pending': row['pending']} for row in conn.execute("SELECT coil_id,COUNT(*) AS total,SUM(json_extract(payload,'$.review_status')='pending') AS pending FROM inspections WHERE coil_id IS NOT NULL GROUP BY coil_id")}
    for row in conn.execute('SELECT id FROM coils'):
        per_coil.setdefault(row['id'], {'total': 0, 'pending': 0})
    return counts, per_coil


def report_summaries(conn):
    # Select only metadata, not the potentially huge nested immutable report evidence.
    fields = ('id', 'coil_id', 'title', 'kind', 'created_at')
    projection = ','.join(f"json_extract(payload,'$.{key}') AS {key}" for key in fields)
    return [{**{key: row[key] for key in fields}, 'summary': json.loads(row['summary'])} for row in conn.execute(f"SELECT {projection},json_extract(payload,'$.summary') AS summary FROM reports ORDER BY rowid DESC")]
