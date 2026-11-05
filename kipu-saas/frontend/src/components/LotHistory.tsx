"use client";
import {useCallback} from 'react';
import {api} from '@/lib/api';
import {useRemoteLoad} from '@/lib/use-remote-load';
import {businessTime} from '@/lib/restaurant';
import {useState} from 'react';
interface Allocation{id:string;direction:string;quantity:string;movement:{type:string;reference:string|null;reason:string|null;createdAt:string}}
export default function LotHistory({lotId}:{lotId:string}){
 const [rows,setRows]=useState<Allocation[]>([]);
 const load=useCallback(()=>api<Allocation[]>(`/inventory/control/lots/${lotId}/movements`),[lotId]);
 const receive=useCallback((data:Allocation[])=>setRows(data),[]);
 const {loading,error,reload}=useRemoteLoad(load,receive,'No se pudo cargar el historial del lote');
 return <div className="mt-3 space-y-2 border-t pt-3"><h3 className="font-semibold">Movimientos del lote</h3>{loading&&<p>Cargando…</p>}{error&&<p role="alert">{error}</p>}<button className="min-h-11 underline" onClick={reload}>Actualizar historial</button>{rows.length===0&&!loading&&<p>Sin movimientos; una clasificación inicial no cambia el stock.</p>}{rows.map(r=><p key={r.id} className="break-words text-xs">{businessTime(r.movement.createdAt)} · {r.direction==='INCREASE'?'+':'−'}{r.quantity} · {r.movement.reason||r.movement.type}<span className="block">Referencia: {r.movement.reference||'Manual'}</span></p>)}<p className="text-xs">Últimos 100 movimientos de este lote.</p></div>;
}
