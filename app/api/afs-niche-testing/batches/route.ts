/**
 * POST /api/afs-niche-testing/batches
 * Creates one draft batch + its topic rows from a pasted list of {description, target_url}.
 * Batch-level defaults (account/page/pixel/countries/category/budget) are copied onto every
 * topic row as-is — major→minor budget conversion is Phase 05's job (topics/{id} PATCH), not here.
 */
import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/utils';
import type { AfsBatch, SpecialAdCategory } from '@/lib/types';

const MAX_TOPICS = 20;
const SPECIAL_AD_CATEGORIES: SpecialAdCategory[] = ['NONE', 'EMPLOYMENT', 'HOUSING', 'CREDIT', 'ISSUES_ELECTIONS_POLITICS'];

interface TopicInput {
  description?: unknown;
  target_url?: unknown;
}

interface CreateBatchBody {
  name?: string;
  topics?: TopicInput[];
  ad_account_id?: string;
  page_id?: string;
  page_name?: string;
  pixel_id?: string;
  countries?: unknown;
  special_ad_category?: string;
  daily_budget_minor?: unknown;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse('Unauthorized', 401);

  const denied = await requireRole(user.id, ['admin', 'leader']);
  if (denied) return denied;

  let body: CreateBatchBody;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const topicsInput = Array.isArray(body.topics) ? body.topics : [];
  if (topicsInput.length === 0) return errorResponse('At least one topic is required', 400);
  if (topicsInput.length > MAX_TOPICS) return errorResponse(`No more than ${MAX_TOPICS} topics per batch`, 400);

  for (const [i, t] of topicsInput.entries()) {
    if (typeof t?.description !== 'string' || !t.description.trim()) {
      return errorResponse(`Topic ${i + 1}: description is required`, 400);
    }
    if (typeof t?.target_url !== 'string' || !t.target_url.startsWith('https://')) {
      return errorResponse(`Topic ${i + 1}: target_url must start with https://`, 400);
    }
  }

  const category = SPECIAL_AD_CATEGORIES.includes(body.special_ad_category as SpecialAdCategory)
    ? (body.special_ad_category as SpecialAdCategory)
    : 'NONE';
  const countries = Array.isArray(body.countries) ? body.countries.filter((c): c is string => typeof c === 'string') : [];
  const dailyBudgetMinor = typeof body.daily_budget_minor === 'number' && body.daily_budget_minor > 0
    ? Math.round(body.daily_budget_minor)
    : undefined;

  // Hard server-side ceiling — the same one the topics/{id} PATCH route enforces. Intake is a
  // valid entry point for daily_budget_minor too (a batch's per-topic default), so it must be
  // checked here as well, not only when a topic's budget is later edited.
  if (dailyBudgetMinor !== undefined) {
    const ceilingRaw = Number(process.env.AFS_MAX_DAILY_BUDGET_MINOR);
    const ceiling = Number.isFinite(ceilingRaw) && ceilingRaw > 0 ? ceilingRaw : 500_000;
    if (dailyBudgetMinor > ceiling) {
      return errorResponse(`daily_budget_minor exceeds the maximum allowed daily budget (${ceiling} minor units)`, 400);
    }
  }

  const batchName = body.name?.trim() || `Batch ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const { data: batch, error: batchError } = await supabase
    .from('afs_batches')
    .insert({ user_id: user.id, name: batchName })
    .select('*')
    .single();
  if (batchError || !batch) return errorResponse(batchError?.message ?? 'Failed to create batch', 500);

  const typedBatch = batch as AfsBatch;
  const topicRows = topicsInput.map((t, i) => ({
    batch_id: typedBatch.id,
    user_id: user.id,
    position: i,
    topic_text: (t.description as string).trim(),
    target_url: (t.target_url as string).trim(),
    ad_account_id: body.ad_account_id || null,
    page_id: body.page_id || null,
    page_name: body.page_name || null,
    pixel_id: body.pixel_id || null,
    countries,
    special_ad_category: category,
    ...(dailyBudgetMinor !== undefined ? { daily_budget_minor: dailyBudgetMinor } : {}),
  }));

  const { data: topics, error: topicsError } = await supabase.from('afs_topics').insert(topicRows).select('*');
  if (topicsError) {
    // Roll back the empty batch shell so it doesn't linger as an orphan with zero topics.
    await supabase.from('afs_batches').delete().eq('id', typedBatch.id);
    return errorResponse(topicsError.message, 500);
  }

  return Response.json({ batch: typedBatch, topics: topics ?? [] }, { status: 201 });
}
