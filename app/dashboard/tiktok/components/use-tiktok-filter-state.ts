'use client';

import { useMemo, useState } from 'react';
import type { TiktokCampaignFilters } from '@/lib/tiktok/filter-campaigns';

/** All TikTok hub filter inputs in one place (keeps the hub component small). */
export function useTiktokFilterState() {
  const [campaignName, setCampaignName] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [accountFilter, setAccountFilter] = useState('');
  const [selectedApps, setSelectedApps] = useState<string[]>([]);
  const [roasMin, setRoasMin] = useState(''); const [roasMax, setRoasMax] = useState('');
  const [spendMin, setSpendMin] = useState(''); const [spendMax, setSpendMax] = useState('');
  const [budgetMin, setBudgetMin] = useState(''); const [budgetMax, setBudgetMax] = useState('');

  // Memoized so consumers can depend on it in useMemo without recomputing every render.
  const filters = useMemo<TiktokCampaignFilters>(() => ({
    campaignName, statusFilter, accountFilter, selectedApps,
    roasMin, roasMax, spendMin, spendMax, budgetMin, budgetMax,
  }), [campaignName, statusFilter, accountFilter, selectedApps, roasMin, roasMax, spendMin, spendMax, budgetMin, budgetMax]);

  function clearAll() {
    setCampaignName(''); setAccountFilter(''); setSelectedApps([]); setStatusFilter('all');
    setRoasMin(''); setRoasMax(''); setSpendMin(''); setSpendMax('');
    setBudgetMin(''); setBudgetMax('');
  }

  return {
    filters, clearAll,
    setCampaignName, setStatusFilter, setAccountFilter, setSelectedApps,
    setRoasMin, setRoasMax, setSpendMin, setSpendMax, setBudgetMin, setBudgetMax,
  };
}
