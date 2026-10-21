import React from 'react';
import { Building2, Footprints, Globe } from 'lucide-react';
import { Badge } from '../ui/badge';
import { visitOrigin } from '../../lib/visitOrigin';
import { cn } from '../../lib/utils';

const ICONS = { walk_in: Footprints, online: Globe, clinic: Building2 };

/**
 * How a visit came about: walk-in, booked online, or booked by the clinic. [1.136.0] Words and an
 * icon, never colour alone. Nothing when the origin is not known.
 */
export default function OriginBadge({ row, className }) {
  const origin = visitOrigin(row);
  if (!origin) return null;
  const Icon = ICONS[origin.key];
  return (
    <Badge variant="outline" data-testid="visit-origin" data-origin={origin.key} className={cn('gap-1', className)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {origin.label}
    </Badge>
  );
}
