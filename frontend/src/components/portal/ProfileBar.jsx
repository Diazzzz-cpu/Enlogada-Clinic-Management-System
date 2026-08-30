import React from 'react';
import AddProfileDialog from './AddProfileDialog';
import EditProfileDialog from './EditProfileDialog';
import { User } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

/**
 * Which patient this dashboard is currently about.
 *
 * Lifted out of ClientDashboard, which rendered the profile switcher, two profile dialogs,
 * a hero and four tab panels from one 1,044-line file. The props are the hooks it reads.
 */
export default function ProfileBar({ profiles, reference }) {
  return (
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-surface border border-line rounded-xl p-4 gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center font-bold">
            <User className="w-5 h-5" />
          </div>
          <div>
            <span className="field-label">Active Profile</span>
            {profiles.profiles.length > 0 ? (
              <Select value={profiles.selectedId} onValueChange={profiles.setSelectedId}>
                <SelectTrigger className="w-64 border-0 p-0 font-bold text-slate-800 focus:ring-0 focus:outline-none bg-transparent" aria-label="Active patient profile">
                  <SelectValue placeholder="Select patient profile" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.profiles.map(p => (
                    <SelectItem key={p.id} value={p.id.toString()}>
                      {p.first_name} {p.last_name} ({p.patient_type_name || 'Patient'})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-sm text-gray-500 font-medium italic">No profiles created yet</span>
            )}
          </div>
        </div>

        <AddProfileDialog profiles={profiles} reference={reference} />

        {/* Edit Profile Dialog (Module 4: Patient Management) */}
        <EditProfileDialog profiles={profiles} reference={reference} />
      </div>
  );
}
