import xlrd,re,json,sys
b=xlrd.open_workbook(sys.argv[1])
MAIN=[('一','一年级','一年级'),('二 ','二年级','二年级'),('三 (1)','三年级','三（1）班'),('三（2）','三年级','三（2）班'),('四（1）','四年级','四（1）班'),('四 (2)','四年级','四（2）班'),('五（1)','五年级','五（1）班'),('五 (2)','五年级','五（2）班'),('六 ','六年级','六年级')]
COLS=[1,2,4,5,6,8]  # 6 节
classes=[];lessons=[];subj={};teach={}
for i,(sn,g,cn) in enumerate(MAIN):
    sh=b.sheet_by_name(sn); cid=f"c{i+1}"
    classes.append(dict(id=cid,name=cn,grade=g,order=i+1))
    for d in range(5):
        r=3+d
        for p,c in enumerate(COLS):
            v=str(sh.cell_value(r,c)).strip()
            if not v: continue
            m=re.search(r'[（(]\s*([^）)]+?)\s*[）)]',v)
            t=m.group(1).strip() if m else None
            s=re.sub(r'[（(][^）)]*[）)]','',v)
            s='/'.join(x.strip() for x in s.split('\n') if x.strip())
            subj.setdefault(s,0);subj[s]+=1
            if t: teach.setdefault(t,0);teach[t]+=1
            lessons.append(dict(classId=cid,day=d,period=p,subject=s,teacher=t,raw=v))
json.dump(dict(classes=classes,lessons=lessons),open('raw.json','w'),ensure_ascii=False,indent=0)
print(len(lessons));print(subj);print(teach)
for l in lessons:
    if not l['teacher']: print('NO TEACHER',l)
