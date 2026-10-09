import type { ComponentType } from 'react';

export interface Employee {
  id: string;
  name: string;
  role: string;
  weeklyHours: number;
}
export interface RateRecord {
  id: string;
  employeeId: string;
  validFrom: string;
  hourlyCost: number;
}
export interface Project {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}
export interface BreakdownItem {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
}
/** amount is always person-months. Absent editSequence means untouched seed data. */
export interface Allocation {
  id: string;
  breakdownItemId: string;
  employeeId: string;
  month: string;
  amount: number;
  editSequence?: number;
  editedBy?: string;
}
export interface SeedData {
  meta: { name: string; version: string; gridHorizon: { from: string; to: string }; note: string };
  employees: readonly Employee[];
  rateRecords: readonly RateRecord[];
  projects: readonly Project[];
  breakdownItems: readonly BreakdownItem[];
  allocations: readonly Allocation[];
}
export interface PlanningData extends SeedData {
  revision: number;
  editSequence: number;
}
export type Currency = 'EUR' | 'USD' | 'GBP';
export type AllocationUnit = 'hours' | 'pm' | 'percent' | 'cost';
export interface Session {
  activeUser: string;
  currency: Currency;
}
export type Subscribe = (listener: () => void) => () => void;
export interface SessionService {
  getSnapshot: () => Session;
  subscribe: Subscribe;
  setActiveUser: (id: string) => void;
  setCurrency: (currency: Currency) => void;
}
export interface PeopleCommands {
  saveRate: (record: Omit<RateRecord, 'id'> & { id?: string }) => Promise<void>;
  removeRate: (id: string) => Promise<void>;
}
export interface DeliveryCommands {
  createItem: (input: Omit<BreakdownItem, 'id'>) => Promise<void>;
  renameItem: (id: string, name: string) => Promise<void>;
  moveItem: (id: string, parentId: string | null) => Promise<void>;
  /** Explicit cascade: deletes the node, all descendants and their allocations atomically. */
  deleteItem: (id: string) => Promise<void>;
  setAllocation: (input: Omit<Allocation, 'id' | 'editSequence' | 'editedBy'>) => Promise<void>;
}
/** One authoritative persistence adapter; remotes receive capabilities, never sibling internals. */
export interface PlanningService {
  getSnapshot: () => PlanningData;
  subscribe: Subscribe;
  people: PeopleCommands;
  delivery: DeliveryCommands;
}
export interface AppServices {
  planning: PlanningService;
  session: SessionService;
}
export interface RemoteProps {
  services: AppServices;
}
export interface RemoteModule {
  default: ComponentType<RemoteProps>;
  reactIdentity: unknown;
}
export interface RuntimeConfig {
  peopleUrl: string;
  deliveryUrl: string;
  seedUrl: string;
}
