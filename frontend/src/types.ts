export interface Hour {
  start: string; end: string; duration_seconds: number; elapsed_seconds: number;
  good_seconds: number; speed_loss_seconds: number; microstop_seconds: number;
  downtime_seconds: number; scrap_loss_seconds: number; unknown_seconds: number;
  excluded_break_seconds: number; good_count: number; scrap_count: number;
  target_good: number | null; oee: number | null; performance: number | null;
  status: string; warnings: string[]; current: boolean;
  piece_equivalents?: { good: number; speed_loss: number; microstop: number;
    downtime: number; break: number; scrap: number; unknown: number } | null;
}
export interface DashboardData {
  status: 'ok' | 'stale' | 'outside_shift'; server_time: string; refresh_seconds: number;
  data_source?: 'mock' | 'ciclades' | 'euromap63';
  last_successful_update?: string | null;
  display_settings?: DashboardSettings;
  display: { id: string; name: string; theme: 'dark' | 'light' };
  machine: { id: string; name: string };
  shift?: { id: string; name: string; start: string; end: string };
  shift_navigation?: { previous: string | null; next: string | null; is_current: boolean };
  production?: { product: string | null; order: string | null; target: number | null;
    actual_good: number; scrap: number; delta: number | null };
  hours?: Hour[];
  summary?: { availability: number | null; performance: number | null; quality: number | null;
    oee: number | null; status: string; warnings: string[];
    good_count: number; scrap_count: number; scrap_percent: number | null;
    downtime_seconds: number; speed_loss_seconds: number };
  live_shift?: {
    machine_code: string; detail_url: string | null;
    stop_source: 'cycles' | 'histo_events' | null;
    downtime_available: boolean; cycles_endpoint_available: boolean; cycles_available: boolean;
    hours: { start: string; end: string; elapsed_seconds: number; cycle_count: number | null;
      stop_seconds: number | null; stop_count: number | null }[];
    cycle_bins: { start: string; count: number }[];
    downtime_events: { start: string; end: string; seconds: number; reason: string }[];
    summary: { recorded_cycles: number | null; observed_stop_seconds: number | null;
      observed_stop_count: number | null };
  };
}
export interface DashboardSettings { refresh_seconds: number; visible_kpis: string[]; oee_warning_threshold: number }
export interface Machine { id: string; mes_id: string; name: string; active: boolean;
  fleet_enabled: boolean; pieces_per_cycle: number; ideal_cycle_seconds: number | null }
export interface Shift { id: string; name: string; start_time: string; end_time: string;
  days: number[]; active: boolean }
export interface Display { id: string; name: string; machine_id: string;
  dashboard_type: string; theme: 'dark' | 'light'; active: boolean; online: boolean; last_seen: string | null }
export interface ImprintData extends Omit<DashboardData, 'hours'> {
  ticks?: string[];
  hours?: Hour[];
  downtime_events?: { start: string; end: string; category: string; reason: string; seconds: number }[];
  downtime_reasons?: { category: string; reason: string; seconds: number }[];
  scrap_reports?: { at: string; count: number; reason: string }[];
  scrap_reasons?: { reason: string; count: number }[];
  downtime_detail_available?: boolean;
  scrap_detail_available?: boolean;
}

export interface FleetMachine {
  id: string; name: string; mes_id: string; display_id: string | null;
  kpi_state: 'on_track' | 'attention' | 'stale' | 'no_data' | 'outside_shift' | 'unavailable' | 'unconfigured';
  live_state: 'bezi' | 'stoji' | 'bez_zakazky' | 'neznamo' | null;
  oee: number | null; good_count: number | null; target_good: number | null;
  scrap_count: number | null; downtime_seconds: number | null;
  shift_name: string | null; product: string | null; order: string | null;
  tool: string | null; stop_reason: string | null;
  cycle_time_real_s: number | null; cycle_time_planned_s: number | null;
  collector_status: 'ok' | 'stale' | 'unknown' | null; last_cycle_age_s: number | null;
  worst_cavity_scrap: { cavity_no: number | null; reject_pct: number; target_pct: number | null; product: string | null } | null;
  live_detail_url: string | null; warnings: string[]; last_successful_update: string | null;
}
export interface FleetData {
  server_time: string; refresh_seconds: number; data_source: string;
  live_source: 'euromap63' | 'demo' | 'unavailable' | 'not_configured';
  oee_warning_threshold: number;
  summary: { total: number; running: number | null; stopped: number | null; without_order: number | null;
    with_cycle_time: number | null; collectors_online: number | null; collectors_stale: number | null;
    attention: number; unavailable: number; average_oee: number | null };
  machines: FleetMachine[];
}
