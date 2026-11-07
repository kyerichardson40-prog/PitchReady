/** Stand-in for `next/link` in the standalone demo build. */
import type { MouseEvent, ReactNode } from 'react';
import { go } from './next-navigation.ts';

export default function Link({ href, children, prefetch: _prefetch, ...rest }: { href: string; children: ReactNode; prefetch?: boolean; className?: string; 'aria-current'?: 'page'; 'aria-label'?: string }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => { e.preventDefault(); go(href); };
  return <a href="#" onClick={onClick} {...rest}>{children}</a>;
}
