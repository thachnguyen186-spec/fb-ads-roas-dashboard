/**
 * AFS Niche Testing — Facebook write calls for campaign → adset → creative → ad creation.
 * Every non-scalar param is JSON.stringify'd before being handed to fbPostForm, which does
 * `String(v)` on each value internally — an un-stringified array/object would silently become
 * `''` (empty array) or `'[object Object]'`. Uses AFS_FB_API_BASE (v22.0) exclusively.
 *
 * ============================ PRE-PRODUCTION GATE — READ FIRST ============================
 * This sandbox has no live Facebook Business Manager credentials, so the manual Ads Manager
 * canary called for by phase-03's "Pre-Implementation Gate" (create one real traffic campaign
 * by hand and confirm the enum matrix below) could NOT be run here. The enum combination below
 * is assumed from research (plans/reports/researcher-260731-1539-fb-marketing-api-ad-creation.md
 * §1-2, §4) but is UNVERIFIED against a real ad account:
 *   - objective              = OUTCOME_TRAFFIC
 *   - optimization_goal      = LINK_CLICKS
 *   - billing_event          = IMPRESSIONS
 *   - destination_type       = WEBSITE
 *   - bid_strategy           = LOWEST_COST_WITHOUT_CAP
 *   - special_ad_categories  = JSON array (`[]` when none, e.g. `["EMPLOYMENT"]` — NOT the
 *                              string "NONE"; research found doc text self-contradictory here)
 * Whoever has real FB Business Manager / App access MUST create one manual campaign with these
 * exact values (per phase-03's Pre-Implementation Gate and the Phase 06 Launch Gate canary,
 * using a genuine external leader account, NOT a developer's own BM) before the first real
 * multi-topic publish. A wrong enum here 400s the entire batch.
 * ============================================================================================
 *
 * Budget is a PURE PASS-THROUGH: `topic.daily_budget_minor` already holds FB-ready minor units
 * (Phase 01's authoritative unit contract — cents for USD, whole units for VND). This file never
 * multiplies/converts it; that conversion happens exactly once, in Phase 05's PATCH intake route.
 */

import { fbPostForm, AFS_FB_API_BASE } from './fb-client';

export interface CreateCampaignParams {
  accountId: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED';
  /** JSON array contents, e.g. [] or ['EMPLOYMENT'] — this function stringifies it. */
  specialAdCategories: string[];
}

export async function createCampaign(token: string, params: CreateCampaignParams): Promise<{ id: string }> {
  const { accountId, name, status, specialAdCategories } = params;
  return fbPostForm(`/${accountId}/campaigns`, {
    name,
    objective: 'OUTCOME_TRAFFIC',
    status,
    special_ad_categories: JSON.stringify(specialAdCategories),
  }, token, AFS_FB_API_BASE) as Promise<{ id: string }>;
}

export interface CreateAdSetParams {
  accountId: string;
  campaignId: string;
  name: string;
  /** Pass-through only — already FB-ready minor units. See file header. */
  dailyBudgetMinor: number;
  countries: string[];
  status: 'ACTIVE' | 'PAUSED';
  pixelId?: string | null;
}

export async function createAdSet(token: string, params: CreateAdSetParams): Promise<{ id: string }> {
  const { accountId, campaignId, name, dailyBudgetMinor, countries, status, pixelId } = params;
  const body: Record<string, unknown> = {
    name,
    campaign_id: campaignId,
    daily_budget: String(dailyBudgetMinor),
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'LINK_CLICKS',
    destination_type: 'WEBSITE',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    status,
    targeting: JSON.stringify({ geo_locations: { countries } }),
  };
  if (pixelId) {
    body.promoted_object = JSON.stringify({ pixel_id: pixelId });
  }
  return fbPostForm(`/${accountId}/adsets`, body, token, AFS_FB_API_BASE) as Promise<{ id: string }>;
}

export interface CreateAdCreativeParams {
  accountId: string;
  pageId: string;
  targetUrl: string;
  primaryText: string;
  adHeadline: string;
  imageHash: string;
}

export async function createAdCreative(token: string, params: CreateAdCreativeParams): Promise<{ id: string }> {
  const { accountId, pageId, targetUrl, primaryText, adHeadline, imageHash } = params;
  const objectStorySpec = {
    page_id: pageId,
    link_data: {
      link: targetUrl,
      message: primaryText,
      name: adHeadline,
      image_hash: imageHash,
      call_to_action: { type: 'LEARN_MORE', value: { link: targetUrl } },
    },
  };
  const degreesOfFreedomSpec = {
    creative_features_spec: { standard_enhancements: { enroll_status: 'OPT_OUT' } },
  };
  return fbPostForm(`/${accountId}/adcreatives`, {
    object_story_spec: JSON.stringify(objectStorySpec),
    degrees_of_freedom_spec: JSON.stringify(degreesOfFreedomSpec),
  }, token, AFS_FB_API_BASE) as Promise<{ id: string }>;
}

export interface CreateAdParams {
  accountId: string;
  adsetId: string;
  name: string;
  creativeId: string;
  status: 'ACTIVE' | 'PAUSED';
}

export async function createAd(token: string, params: CreateAdParams): Promise<{ id: string }> {
  const { accountId, adsetId, name, creativeId, status } = params;
  return fbPostForm(`/${accountId}/ads`, {
    name,
    adset_id: adsetId,
    creative: JSON.stringify({ creative_id: creativeId }),
    status,
  }, token, AFS_FB_API_BASE) as Promise<{ id: string }>;
}
