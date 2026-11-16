import re,html,json,sys
c=open(sys.argv[1]).read()
secs=re.split(r'<h2 class="wp-block-heading" id="([^"]+)">',c)
out={}
def clean(x):
    x=re.sub(r'<br\s*/?>','\n',x); x=re.sub(r'<[^>]+>','',x); return [html.unescape(l).strip() for l in x.split('\n') if l.strip()]
for i in range(1,len(secs),2):
    sid=secs[i]; body=secs[i+1]
    heads=re.findall(r'<th[^>]*>(.*?)</th>',body)
    rows=[]
    for tr in re.findall(r'<tr class="row-\d+">(.*?)</tr>',body,re.S):
        tds=re.findall(r'<td[^>]*>(.*?)</td>',tr,re.S)
        if not tds: continue
        row=[]
        for td in tds:
            img=re.search(r'src="([^"]+)"',td)
            row.append({'text':clean(td),'img':img.group(1) if img else None})
        rows.append(row)
    out[sid]={'heads':[re.sub('<[^>]+>','',h) for h in heads],'rows':rows}
json.dump(out,open(sys.argv[2],'w'),ensure_ascii=False,indent=1)
for k,v in out.items(): print(k,v['heads'],len(v['rows']))
