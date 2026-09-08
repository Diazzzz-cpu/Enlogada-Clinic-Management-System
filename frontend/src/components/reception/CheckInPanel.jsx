import React from 'react';
import { AlertCircle, CalendarClock, Camera, CheckCircle2, Keyboard, QrCode, UserCheck, UserX } from 'lucide-react';
import { formatAppointmentDate, formatTime12 } from '../../lib/date';
import { Button } from '../ui/button';
import { Panel } from '../ui/panel';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { StatusBadge } from '../ui/status-badge';
import QrScanner from '../QrScanner';

/**
 * Admitting a booked patient from their reference or QR code.
 *
 * Lifted out of ReceptionistDashboard, which rendered four unrelated screens from one
 * 1,048-line file. The props are the hooks this screen actually reads — listed rather than
 * reached for, so what each view depends on is visible at its top instead of inferred by
 * scrolling.
 */
export default function CheckInPanel({ checkIn, disposition }) {
  return (
        <Panel className="max-w-xl p-6">
          <div className="border-b border-line pb-3 mb-4">
            <h2 className="m-0 flex items-center gap-2 text-lead font-bold tracking-tight text-slate-900">
              <QrCode className="h-4 w-4 text-brand-600" />
              <span>Verify Appointment Reference</span>
            </h2>
            <p className="mt-1 text-fine leading-relaxed text-slate-500">
              Scan or enter the appointment reference code (e.g. <code>APPT-XXXXX</code>) to check a patient in.
            </p>
          </div>

          <button
            type="button"
            onClick={checkIn.toggleScanMode}
            className="flex items-center space-x-1.5 text-fine font-bold text-brand-600 hover:text-[#657c3a] cursor-pointer mb-3"
          >
            {checkIn.scanMode ? <Keyboard className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
            <span>{checkIn.scanMode ? 'Switch to manual entry' : 'Scan QR with camera'}</span>
          </button>

          {checkIn.scanMode && (
            <QrScanner
              active={checkIn.scanMode}
              onScan={checkIn.scanned}
              onError={checkIn.reportError}
            />
          )}

          <form onSubmit={checkIn.verify} className="space-y-4 pt-2">
            <div className="flex space-x-2">
              <Input
                aria-label="Appointment reference code"
                placeholder="APPT-104928"
                value={checkIn.reference}
                onChange={e => checkIn.setReference(e.target.value)}
                className="text-xs rounded-xl"
              />
              <Button type="submit" className="text-xs font-bold px-4">
                Lookup
              </Button>
            </div>

            {checkIn.verifyError && (
              <div role="alert" className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{checkIn.verifyError}</span>
              </div>
            )}

            {checkIn.notice && (
              <div role="status" className="alert alert-success">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>{checkIn.notice}</span>
              </div>
            )}
            {checkIn.guidance && (
              <div role="status" className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl space-y-1.5 text-xs">
                <div className="flex items-center space-x-2 font-bold">
                  <UserCheck className="w-4 h-4 flex-shrink-0" />
                  <span>{checkIn.guidance.patientName} is checked in.</span>
                </div>
                {checkIn.guidance.categories.length > 0 ? (
                  <p className="m-0">
                    Please guide the patient to: <strong>{checkIn.guidance.categories.join(', ')}</strong>.
                  </p>
                ) : (
                  <p className="m-0">No tests are attached to this visit yet — attach tests from the Active Queue before sending the patient anywhere.</p>
                )}
              </div>
            )}

            {checkIn.result && (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-3 text-xs">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-gray-500 uppercase">Patient</span>
                  <span className="font-extrabold text-slate-900">{checkIn.result.first_name} {checkIn.result.last_name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-bold text-gray-500 uppercase">Scheduled</span>
                  {/* The API sends scheduled_date as a full ISO instant, so interpolating it
                      raw printed "2026-08-10T16:00:00.000Z" — unreadable, and one day behind
                      the real date on a UTC+8 clock. This is the screen where reception
                      confirms a booking is for today, so it was also the worst place for it. */}
                  <span className="font-bold text-gray-800">{formatAppointmentDate(checkIn.result.scheduled_date)} at {formatTime12(checkIn.result.scheduled_time)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-bold text-gray-500 uppercase">Queue Ticket</span>
                  <Badge className="bg-primary text-primary-foreground font-extrabold">{checkIn.result.queue_number}</Badge>
                </div>

                {/* Payment is the other half of the release rule, so the front desk needs to
                    see it before checking anyone in — otherwise they check the patient in,
                    nothing appears at the modality, and nobody knows why. */}
                <div className="flex justify-between items-center">
                  <span className="font-bold text-gray-500 uppercase">Payment</span>
                  <StatusBadge status={checkIn.result.is_paid ? 'Paid' : 'Pending'} />
                </div>

                {!checkIn.result.is_paid && (
                  <p className="text-fine text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 m-0">
                    This booking has no confirmed payment yet. You can still check the patient in, but the
                    ticket will only reach the department once the cashier confirms payment.
                  </p>
                )}

                <Button
                  type="button"
                  onClick={() => checkIn.request('appointment', checkIn.result)}
                  className="w-full font-bold py-2 rounded-xl"
                >
                  Confirm Check-In Patient
                </Button>

                {/* The desk's half of rescheduling. This screen is where a receptionist already
                    has a booking in hand — from a scan, or from the reference a patient reads
                    out over the phone — so it is where "can I move this to Thursday?" gets
                    answered. Only offered while the booking is still Pending: once it is
                    Confirmed the patient is standing here, and a new date is not what is being
                    asked for. */}
                {checkIn.result.status === 'Pending' && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => disposition.reschedule.open(checkIn.result)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2 font-bold"
                  >
                    <CalendarClock className="h-3.5 w-3.5" />
                    <span>Reschedule this booking</span>
                  </Button>
                )}

                <button
                  type="button"
                  onClick={() => disposition.noShow.request(checkIn.result)}
                  className="w-full flex items-center justify-center space-x-1.5 text-fine font-bold text-red-600 hover:text-red-700 border-0 bg-transparent cursor-pointer py-1"
                >
                  <UserX className="w-3.5 h-3.5" />
                  <span>Mark as No-Show instead</span>
                </button>
              </div>
            )}
          </form>
        </Panel>
  );
}
