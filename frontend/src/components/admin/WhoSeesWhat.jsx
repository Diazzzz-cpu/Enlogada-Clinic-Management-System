import React, { Fragment } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Lock } from 'lucide-react';
import { Panel, PanelHeader, PanelFooter } from '../ui/panel';
import { Button } from '../ui/button';
import RefreshButton from '../ui/refresh-button';
import { useFreshness } from '../../hooks/useFreshness';
import { cn } from '../../lib/utils';
import { LOCKED, areaCell, cellState, permissionLabel } from '../../lib/whoSeesWhat';

// The mark says it at a glance and the sentence says it in words; the chip is decoration beside a
// sentence that already carries the meaning, so it is hidden from screen readers.
const MARK = {
  yes: { glyph: '✓', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  part: { glyph: '◐', tone: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  no: { glyph: '–', tone: 'bg-slate-100 text-slate-500 ring-slate-200' },
};

/**
 * One switch in the grid. A checkbox underneath rather than a switch role, because a column of
 * three departments can be partly on, and only a checkbox can say "mixed".
 */
function CellSwitch({ state, label, onClick, disabled }) {
  const on = state === 'on';
  const mixed = state === 'mixed';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? 'mixed' : on}
      aria-label={label}
      title={mixed ? 'On for some of these departments. Press to turn it on for all of them.' : undefined}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer items-center rounded-full border-0 p-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-60',
        on ? 'bg-primary' : mixed ? 'bg-amber-400' : 'bg-slate-300'
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgb(15_23_42_/_0.25)] transition-[left]',
          on ? 'left-[1.125rem]' : mixed ? 'left-2.5' : 'left-0.5'
        )}
      />
    </button>
  );
}

/**
 * "Who sees what" — SuperAdmin assigns access here. [1.78.0]
 *
 * Steven's picture, made editable: a row for each kind of information, a column for each kind of
 * staff, and in every cell a mark and a sentence. Opening a row shows one switch per permission per
 * column; the sentence above them is worked out from those switches (lib/whoSeesWhat.js), so the
 * words cannot drift from what the server enforces. Nothing saves until Save, and until then every
 * change is listed in plain words, because this screen decides who may take money and who may
 * release a result.
 */
export default function WhoSeesWhat({ access, grid }) {
  const updatedAt = useFreshness(access.loading, access.loadError);
  const width = grid.columns.length;

  return (
    <Panel className="overflow-hidden" data-testid="who-sees-what">
      {/* No title: the Super Admin tab right above already says "Who sees what". The line is a
          child rather than `description`, which truncates: on a phone it lost "Open a row to
          change it", the one instruction the grid needs. */}
      <PanelHeader
        actions={
          <>
            <RefreshButton compact onRefresh={access.reload} loading={access.loading} updatedAt={updatedAt} />
            <Button variant="outline" size="sm" aria-pressed={grid.split} onClick={grid.toggleSplit}>
              {grid.split ? 'Group the departments' : 'Each department'}
            </Button>
            <Button variant="outline" size="sm" onClick={grid.toggleAll}>
              {grid.allOpen ? 'Close every row' : 'Open every row'}
            </Button>
          </>
        }
      >
        <p className="m-0 text-fine text-slate-500">What each kind of staff can see and do. Open a row to change it.</p>
      </PanelHeader>

      {/* Its own scroller: at phone width the grid is wider than the screen, and the page must not
          scroll sideways. */}
      <p className="m-0 px-5 pt-3 text-fine text-slate-500 sm:hidden">Swipe the grid sideways to see every column.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-left">
          <thead>
            <tr className="text-micro font-semibold uppercase tracking-[0.1em] text-slate-500">
              <th scope="col" className="w-[24%] px-5 py-3 font-semibold">Information</th>
              {grid.columns.map((column) => (
                <th key={column.key} scope="col" className="px-3 py-3 font-semibold">{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.areas.map((area) => {
              const isOpen = grid.open.has(area.key);
              return (
                <Fragment key={area.key}>
                  <tr data-testid="who-row" data-area={area.key} className="border-t border-line align-top">
                    <th scope="row" className="px-5 py-3 font-normal">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => grid.toggleArea(area.key)}
                        className="group flex w-full cursor-pointer items-start gap-1.5 border-0 bg-transparent p-0 text-left"
                      >
                        <ChevronRight
                          aria-hidden="true"
                          className={cn('mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400 transition-transform group-hover:text-slate-600', isOpen && 'rotate-90')}
                        />
                        <span className="min-w-0">
                          <span className="block text-note font-bold text-slate-900">{area.label}</span>
                          {area.note && <span className="block text-fine text-slate-500">{area.note}</span>}
                        </span>
                      </button>
                    </th>
                    {grid.columns.map((column) => {
                      const cell = areaCell(area, grid.draft, column);
                      const mark = MARK[cell.mark];
                      return (
                        <td key={column.key} data-testid="who-cell" data-column={column.key} data-mark={cell.mark} className="px-3 py-3">
                          <span className="flex items-start gap-2">
                            <span aria-hidden="true" className={cn('flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-micro font-black ring-1 ring-inset', mark.tone)}>
                              {mark.glyph}
                            </span>
                            <span className="text-fine leading-snug text-slate-600">{cell.text}</span>
                          </span>
                        </td>
                      );
                    })}
                  </tr>

                  {isOpen && area.permissions.map((permission) => (
                    <tr
                      key={permission.name}
                      data-testid="who-permission"
                      data-permission={permission.name}
                      className="border-t border-line-soft bg-slate-50/60 align-middle"
                    >
                      <th scope="row" className="py-2 pl-11 pr-5 text-fine font-normal text-slate-700">
                        {permission.label}
                        {grid.newlyUnheld.includes(permission.name) && (
                          <span className="mt-0.5 flex items-center gap-1 text-micro font-semibold text-amber-800">
                            <AlertTriangle aria-hidden="true" className="h-3 w-3" />
                            Nobody but SuperAdmin will be able to
                          </span>
                        )}
                      </th>
                      {LOCKED[permission.name] ? (
                        <td colSpan={width} className="px-3 py-2 text-fine text-slate-500">
                          <span className="inline-flex items-center gap-1.5">
                            <Lock aria-hidden="true" className="h-3.5 w-3.5" />
                            {LOCKED[permission.name]}. Deciding who sees what is what makes SuperAdmin different from Admin.
                          </span>
                        </td>
                      ) : grid.columns.map((column) => (
                        <td key={column.key} className="px-3 py-2">
                          <CellSwitch
                            state={cellState(grid.draft, permission.name, column.roles)}
                            label={`${column.label}: ${permission.label}`}
                            onClick={() => grid.flip(permission.name, column)}
                            disabled={grid.saving}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <PanelFooter>
        <div className="min-w-0 flex-1 space-y-1.5" data-testid="who-changes">
          {grid.saveError && <p role="alert" className="m-0 text-fine font-semibold text-rose-700">{grid.saveError}</p>}
          {grid.changes.length > 0 ? (
            <>
              <p className="m-0 text-fine font-semibold text-slate-800">
                {grid.changes.length} unsaved change{grid.changes.length === 1 ? '' : 's'}
              </p>
              <ul className="m-0 list-disc space-y-0.5 pl-4 text-fine text-slate-600">
                {grid.changes.map((change) => <li key={`${change.on}-${change.permission}`}>{change.text}</li>)}
              </ul>
              {grid.newlyUnheld.length > 0 && (
                <p className="m-0 flex items-start gap-1.5 text-fine font-medium text-amber-800">
                  <AlertTriangle aria-hidden="true" className="mt-px h-3.5 w-3.5 flex-shrink-0" />
                  After this, only SuperAdmin could {grid.newlyUnheld.map((name) => permissionLabel(grid.areas, name).toLowerCase()).join('; ')}.
                </p>
              )}
              {grid.incomplete.map((gap) => (
                <p key={gap.permission} data-testid="who-needs" className="m-0 flex items-start gap-1.5 text-fine font-medium text-amber-800">
                  <AlertTriangle aria-hidden="true" className="mt-px h-3.5 w-3.5 flex-shrink-0" />
                  {gap.text}
                </p>
              ))}
            </>
          ) : grid.savedAt ? (
            <span role="status" className="inline-flex items-center gap-1 text-fine font-semibold text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Saved. It applies to everyone in those roles straight away.
            </span>
          ) : (
            <span className="text-fine text-slate-500">No unsaved changes. A change here applies to everyone in that role.</span>
          )}
        </div>
        <div className="flex flex-shrink-0 gap-2">
          <Button variant="outline" onClick={grid.discard} disabled={!grid.changes.length || grid.saving}>Discard</Button>
          <Button onClick={grid.save} loading={grid.saving} disabled={!grid.changes.length}>Save changes</Button>
        </div>
      </PanelFooter>
    </Panel>
  );
}
