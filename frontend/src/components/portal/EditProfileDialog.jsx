import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { DateField, BIRTHDATE_YEAR_RANGE } from '../ui/date-field';
import { todayStr } from '../../lib/date';

/**
 * Correcting a patient profile.
 *
 * Lifted out of ClientDashboard, which rendered the profile switcher, two profile dialogs,
 * a hero and four tab panels from one 1,044-line file. The props are the hooks it reads.
 */
export default function EditProfileDialog({ profiles, reference }) {
  return (
        <Dialog open={profiles.showEdit} onOpenChange={profiles.closeEdit}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-slate-900">Edit Patient Profile</DialogTitle>
              <DialogDescription>
                Update {profiles.selected?.first_name}'s details.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={profiles.edit} className="space-y-4 pt-2">
              {profiles.editError && (
                <div role="alert" className="alert alert-error">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{profiles.editError}</span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor="clientdashboard-first-name" className="text-xs font-semibold text-gray-600 uppercase">First Name <span className="text-rose-600">*</span></label>
                  <Input id="clientdashboard-first-name"
                    placeholder="Juan"
                    value={profiles.editDraft.firstName}
                    onChange={e => profiles.setEditDraft({...profiles.editDraft, firstName: e.target.value})}
                    disabled={profiles.editing}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="clientdashboard-last-name" className="text-xs font-semibold text-gray-600 uppercase">Last Name <span className="text-rose-600">*</span></label>
                  <Input id="clientdashboard-last-name"
                    placeholder="Dela Cruz"
                    value={profiles.editDraft.lastName}
                    onChange={e => profiles.setEditDraft({...profiles.editDraft, lastName: e.target.value})}
                    disabled={profiles.editing}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5 sm:col-span-2">
                  <label htmlFor="editprofile-birthdate" className="text-xs font-semibold text-gray-600 uppercase">Birthdate <span className="text-rose-600">*</span></label>
                  <DateField id="editprofile-birthdate"
                    value={profiles.editDraft.birthdate}
                    onChange={e => profiles.setEditDraft({...profiles.editDraft, birthdate: e.target.value})}
                    disabled={profiles.editing}
                    max={todayStr()}
                    yearRange={BIRTHDATE_YEAR_RANGE}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase" htmlFor="clientdashboard-sex-2">Sex <span className="text-rose-600">*</span></label>
                  <Select
                    value={profiles.editDraft.sex}
                    onValueChange={val => profiles.setEditDraft({...profiles.editDraft, sex: val})}
                    disabled={profiles.editing}
                  >
                    <SelectTrigger id="clientdashboard-sex-2">
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
                    value={profiles.editDraft.contactNumber}
                    onChange={e => profiles.setEditDraft({...profiles.editDraft, contactNumber: e.target.value})}
                    disabled={profiles.editing}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase" htmlFor="clientdashboard-patient-billing-category-3">Patient Billing Category <span className="text-rose-600">*</span></label>
                  <Select
                    value={profiles.editDraft.patientTypeId}
                    onValueChange={val => profiles.setEditDraft({...profiles.editDraft, patientTypeId: val})}
                    disabled={profiles.editing}
                  >
                    <SelectTrigger id="clientdashboard-patient-billing-category-3">
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
                  value={profiles.editDraft.address}
                  onChange={e => profiles.setEditDraft({...profiles.editDraft, address: e.target.value})}
                  disabled={profiles.editing}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="clientdashboard-emergency-contact" className="text-xs font-semibold text-gray-600 uppercase">Emergency Contact</label>
                <Input id="clientdashboard-emergency-contact"
                  placeholder="Name & Contact Number"
                  value={profiles.editDraft.emergencyContact}
                  onChange={e => profiles.setEditDraft({...profiles.editDraft, emergencyContact: e.target.value})}
                  disabled={profiles.editing}
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-line">
                <Button type="button" variant="outline" onClick={() => profiles.closeEdit(false)} disabled={profiles.editing}>Cancel</Button>
                <Button type="submit"  disabled={profiles.editing}>
                  {profiles.editing ? 'Saving…' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
  );
}
