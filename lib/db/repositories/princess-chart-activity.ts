import 'server-only';
import type {PoolConnection} from 'mysql2/promise';
import {sharedTableActivity,type SharedTableActivity,type TablePlayer} from './shared-table-activity';
export type PrincessChartPlayer=TablePlayer;
export type PrincessChartActivity=SharedTableActivity;
export function princessChartActivity(c:PoolConnection,roundId:string,roundNumber:number){return sharedTableActivity(c,'teen_patti',roundId,roundNumber);}
