import { useApp } from './app-context.tsx';
import { capitalise, CHANNEL_INFO, LEGACY_SALES_CONTEXT, type SalesContext } from '../../lib/domain/sales.ts';

/** What this agency calls the other person ("resident", "customer", "prospect"…), plus its sales setting. */
export function useCustomer(): { label: string; Label: string; ctx: SalesContext; channel: (typeof CHANNEL_INFO)[keyof typeof CHANNEL_INFO] } {
  const { ctx } = useApp();
  const sales = ctx?.campaign?.salesContext ?? LEGACY_SALES_CONTEXT;
  return { label: sales.customer_label, Label: capitalise(sales.customer_label), ctx: sales, channel: CHANNEL_INFO[sales.channel] };
}
