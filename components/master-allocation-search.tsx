"use client";

import Image from 'next/image';
import { UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MasterAdjustmentForm } from './master-adjustment-form';
import type { AdjustmentTarget } from '@/lib/finance/master-adjustment';
import { formatNumber } from '@/lib/utils/format';
import styles from './master-allocation.module.css';

function Identity({target}:{target:AdjustmentTarget}) {
  return <><span className={styles.avatar}>{target.avatarUrl?<Image src={target.avatarUrl} width={48} height={48} alt="" className={styles.avatar} unoptimized/>:<UserRound size={26}/>}</span>
    <div className={styles.identity}><h3>{target.name}</h3><p>ID {target.publicId}{target.hostId && target.hostId!==target.publicId ? ` · Host ID ${target.hostId}`:''}</p>
      <small>{target.role.replaceAll('_',' ')} · {target.ownerType==='PLATFORM_ACCOUNT'?'Platform wallet':'App wallet'} · <strong>{target.status}</strong></small>
      {target.agencyName?<p className={styles.hint}>Agency: {target.agencyName} · {target.agencyId}</p>:null}</div></>;
}

export function MasterAllocationSearch({initialQuery=''}:{initialQuery?:string}) {
  const router=useRouter();
  const [query,setQuery]=useState(initialQuery);
  const [items,setItems]=useState<AdjustmentTarget[]>([]);
  const [selected,setSelected]=useState<AdjustmentTarget|null>(null);
  const [page,setPage]=useState(1);
  const [hasNext,setHasNext]=useState(false);
  const [busy,setBusy]=useState(initialQuery.replace(/\s+/g,'').length>=2);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const [pending,setPending]=useState(false);
  const sequence=useRef(0);
  const normalized=query.replace(/\s+/g,'').toLowerCase();
  useEffect(()=>{
    const current=++sequence.current;
    const controller=new AbortController();
    let cancelled=false;
    let timeout:ReturnType<typeof setTimeout>;
    if(normalized.length<2)return;
    const timer=setTimeout(async()=>{
      setBusy(true);setError('');
      timeout=setTimeout(()=>controller.abort(),12_000);
      try {
        const response=await fetch(`/api/control/wallet-adjustments/search?q=${encodeURIComponent(normalized)}&page=${page}`,{cache:'no-store',signal:controller.signal});
        const body=await response.json();
        if(cancelled||current!==sequence.current)return;
        if(!response.ok)throw new Error('Search unavailable');
        setItems(previous=>page===1?body.items:[...previous,...body.items].filter((target,index,all)=>all.findIndex(other=>other.id===target.id&&other.ownerType===target.ownerType)===index));
        setHasNext(body.hasNext);
      } catch {
        if(!cancelled&&current===sequence.current)setError('Account search could not finish. Check your connection and retry.');
      } finally {clearTimeout(timeout);if(!cancelled&&current===sequence.current)setBusy(false);}
    },250);
    return()=>{cancelled=true;clearTimeout(timer);clearTimeout(timeout);controller.abort();};
  },[normalized,page,retry]);
  function completed(target:AdjustmentTarget) {
    setSelected(target);setItems(previous=>previous.map(row=>row.id===target.id&&row.ownerType===target.ownerType?target:row));
    router.refresh();
  }
  return <>
    <label className={styles.search}>Search User ID / Host ID<input aria-label="Search User ID / Host ID" type="search" placeholder="Search User ID / Host ID" autoComplete="off" value={query} maxLength={80} disabled={pending}
      onChange={event=>{setQuery(event.target.value);setSelected(null);setPage(1);setItems([]);setHasNext(false);setError('');setBusy(event.target.value.replace(/\s+/g,'').length>=2);}}/></label>
    <p className={styles.hint}>Type at least 2 characters. Exact IDs first, then ID prefixes. App and platform wallets are identified separately.</p>
    {busy?<p role="status">Searching accounts…</p>:null}
    {error?<p role="alert">{error} <button className="secondary-button" onClick={()=>setRetry(value=>value+1)}>Retry</button></p>:null}
    {!busy&&!error&&normalized.length>=2&&!items.length?<p role="status">No wallet-owning account found. Check the visible Nazraa ID or type more of its prefix.</p>:null}
    {items.length&&!selected?<><h3>Search results</h3><div className={styles.results} aria-label="Allocation search results">{items.map(target=><article key={`${target.ownerType}:${target.id}`} className={styles.account}>
      <Identity target={target}/><div><div>Coins: {formatNumber(target.coins)}</div><div>Diamonds: {formatNumber(target.diamonds)}</div></div>
      <button className="secondary-button" disabled={pending||busy} onClick={()=>setSelected(target)}>Select <span className="sr-only">{target.publicId} {target.ownerType==='PLATFORM_ACCOUNT'?'platform':'app'} wallet</span></button>
    </article>)}</div>{hasNext?<button className="secondary-button" disabled={busy||pending} onClick={()=>setPage(value=>value+1)}>Show more</button>:null}</>:null}
    {selected?<section className={styles.selected} aria-label="Selected account"><div className="action-row"><h2>Selected account</h2><button className="secondary-button" disabled={pending} onClick={()=>{setSelected(null);setRetry(value=>value+1);}}>Change / refresh account</button></div><div className={styles.account}><Identity target={selected}/></div>
      <div className={styles.balances}><span>Coins: <strong>{formatNumber(selected.coins)}</strong></span><span>Diamonds: <strong>{formatNumber(selected.diamonds)}</strong></span></div>
      <MasterAdjustmentForm key={`${selected.ownerType}:${selected.id}`} target={selected} onCompleted={completed} onPendingChange={setPending}/>
    </section>:null}
  </>;
}
