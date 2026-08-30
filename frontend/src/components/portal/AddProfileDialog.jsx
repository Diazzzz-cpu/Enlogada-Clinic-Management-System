import React from 'react';
import { AlertCircle, UserPlus } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../ui/dialog';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { DateField, BIRTHDATE_YEAR_RANGE } from '../ui/date-field';
import { todayStr } from '../../lib/date';

/**
 * Creating a patient profile under this account.
 *
 * Lifted out of ClientDashboard, which rendered the profile switcher, two profile dialogs,
 * a hero and four tab panels from one 1,044-line file. The props are the hooks it reads.
 * 
 * An account owns several profiles — a parent booking for a dependent is the ordinary case,
 * which is why patients are plural everywhere they appear.
 */
export default function AddProfileDialog({ profiles, reference }) {
  return (
        <Dialog open={profiles.showAdd} onOpenChange={profiles.openAdd}>
          <DialogTrigger asChild>
            <Button className="flex items-center space-x-2 rounded-xl font-bold text-xs cursor-pointer transition-all">
              <UserPlus className="w-4 h-4" />
              <span>Add Dependent Profile</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-slate-900">Create Patient Profile</DialogTitle>
              <DialogDescription>
                Register a profile for yourself or a family dependent.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={profiles.add} className="space-y-4 pt-2">
              {profiles.addError && (
                <div role="alert" className="alert alert-error">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{profiles.addError}</span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor="clientdashboard-first-name" className="text-xs font-semibold text-gray-600 uppercase">First Name <span className="text-rose-600">*</span></label>
                  <Input id="clientdashboard-first-name"
                    placeholder="Juan"
                    value={profiles.addDraft.firstName}
                    onChange={e => profiles.setAddDraft({...profiles.addDraft, firstName: e.target.value})}
                    disabled={profiles.adding}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="clientdashboard-last-name" className="text-xs font-semibold text-gray-600 uppercase">Last Name <span className="text-rose-600">*</span></label>
                  <Input id="clientdashboard-last-name"
                    placeholder="Dela Cruz"
                    value={profiles.addDraft.lastName}
                    onChange={e => profiles.setAddDraft({...profiles.addDraft, lastName: e.target.value})}
                    disabled={profiles.adding}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5 sm:col-span-2">
                  <label htmlFor="addprofile-birthdate" className="text-xs font-semibold text-gray-600 uppercase">Birthdate <span className="text-rose-600">*</span></label>
                  {/* id was `clientdashboard-birthdate`, the same string EditProfileDialog
                      used — two dialogs sharing one DOM id, which makes htmlFor ambiguous and
                      a label click focus whichever mounted first. */}
                  <DateField id="addprofile-birthdate"
                    value={profiles.addDraft.birthdate}
                    onChange={e => profiles.setAddDraft({...profiles.addDraft, birthdate: e.target.value})}
                    disabled={profiles.adding}
                    max={todayStr()}
                    yearRange={BIRTHDATE_YEAR_RANGE}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase" htmlFor="clientdashboard-sex">Sex <span className="text-rose-600">*</span></label>
                  <Select
                    value={profiles.addDraft.sex}
                    onValueChange={val => profiles.setAddDraft({...profiles.addDraft, sex: val})}
                    disabled={profiles.adding}
                  >
                    <SelectTrigger id="clientdashboard-sex">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor="clientdashboard-contact-number" className="text-xs font-semibold text-gray-600 uppercase">Contact Number</label>
                  <Input id="clientdashboard-contact-number"
                    placeholder="09171234567"
                    value={profiles.addDraft.contactNumber}
                    onChange={e => profiles.setAddDraft({...profiles.addDraft, contactNumber: e.target.value})}
                    disabled={profiles.adding}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase" htmlFor="clientdashboard-patient-billing-category">Patient Billing Category <span className="text-rose-600">*</span></label>
                  <Select
                    value={profiles.addDraft.patientTypeId}
                    onValueChange={val => profiles.setAddDraft({...profiles.addDraft, patientTypeId: val})}
                    disabled={profiles.adding}
                  >
                    <SelectTrigger id="clientdashboard-patient-billing-category">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      {reference.patientTypes.map(type => (
                        <SelectItem key={type.id} value={type.id.toString()}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="clientdashboard-address" className="text-xs font-semibold text-gray-600 uppercase">Address</label>
                <Input id="clientdashboard-address"
                  placeholder="Barangay, City, Province"
                  value={profiles.addDraft.address}
                  onChange={e => profiles.setAddDraft({...profiles.addDraft, address: e.target.value})}
                  disabled={profiles.adding}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="clientdashboard-emergency-contact" className="text-xs font-semibold text-gray-600 uppercase">Emergency Contact</label>
                <Input id="clientdashboard-emergency-contact"
                  placeholder="Name & Contact Number"
                  value={profiles.addDraft.emergencyContact}
                  onChange={e => profiles.setAddDraft({...profiles.addDraft, emergencyContact: e.target.value})}
                  disabled={profiles.adding}
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-line">
                <Button type="button" variant="outline" onClick={() => profiles.openAdd(false)} disabled={profiles.adding}>Cancel</Button>
                <Button type="submit"  disabled={profiles.adding}>
                  {profiles.adding ? 'Saving…' : 'Save Profile'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
  );
}
