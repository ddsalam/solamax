import re,sys,json,glob,os
rows=[]
amt_re=re.compile(r'\s([\d,]+\.\d{2})( DB)?(?:\s+([\d,]+\.\d{2}))?\s*$')
start_re=re.compile(r'^\s{4,8}(\d{2}/\d{2})\s{3,}(\S.*)$')
for f in sorted(glob.glob(sys.argv[1]+'/*.txt')):
    acct=re.search(r'_(\d+)_(\d{6})',f); acc,per=acct.group(1),acct.group(2)
    cur=None
    for line in open(f,encoding='utf-8'):
        line=line.rstrip('\n')
        if re.search(r'Bersambung|REKENING GIRO|KCP |HALAMAN|PE RIOD|CATATAN|T ANG G A L|SALDO AKHIR|MUTASI CR|MUTASI DB',line): 
            if cur: rows.append(cur); cur=None
            continue
        m=start_re.match(line)
        if m:
            if cur: rows.append(cur)
            body=m.group(2)
            a=amt_re.search(body)
            cur={'acct':acc,'period':per,'date':m.group(1),'desc':[],'amt':None,'dir':None,'saldo':None}
            if a:
                cur['amt']=float(a.group(1).replace(',',''));cur['dir']='DB' if a.group(2) else 'CR'
                cur['saldo']=float(a.group(3).replace(',','')) if a.group(3) else None
                body=body[:a.start()]
            cur['desc'].append(re.sub(r'\s{2,}',' | ',body.strip()))
        elif cur and line.strip():
            if line.startswith(' '*40) or len(line)-len(line.lstrip())>=30:
                cur['desc'].append(line.strip())
            else:
                rows.append(cur);cur=None
    if cur: rows.append(cur)
for r in rows: r['desc']=' / '.join(r['desc'])
json.dump(rows,open(sys.argv[2],'w'),indent=0)
print(len(rows))
