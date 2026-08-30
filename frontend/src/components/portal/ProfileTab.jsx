import React from 'react';
import { Pencil, ShieldCheck, User } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { TabsContent } from '../ui/tabs';

/**
 * The account details behind the patient.
 *
 * Lifted out of ClientDashboard, which rendered the profile switcher, two profile dialogs,
 * a hero and four tab panels from one 1,044-line file. The props are the hooks it reads.
 */
export default function ProfileTab({ profiles }) {
  return (
        <TabsContent value="profile" className="m-0 space-y-4 max-w-2xl">
          {profiles.selected && (
            <Card className="border-line rounded-xl bg-surface overflow-hidden">
              <CardHeader className="bg-slate-50/80 border-b border-line py-3.5 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
                  <User className="w-4 h-4 text-brand-600" />
                  <span>Patient Profile Summary</span>
                </CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  onClick={profiles.openEdit}
                  aria-label="Edit patient profile"
                  className="h-7 w-7 p-0 border-gray-200 text-gray-500 hover:text-brand-600 hover:border-brand-500 rounded-lg"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                <div className="flex justify-between items-center text-xs border-b border-gray-50 pb-2">
                  <span className="text-gray-500 font-medium">Patient ID:</span>
                  <span className="font-extrabold text-slate-900">PT-{profiles.selected.id}</span>
                </div>
                <div className="flex justify-between items-center text-xs border-b border-gray-50 pb-2">
                  <span className="text-gray-500 font-medium">Birthdate:</span>
                  <span className="font-bold text-slate-900">
                    {new Date(profiles.selected.birthdate).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs border-b border-gray-50 pb-2">
                  <span className="text-gray-500 font-medium">Contact:</span>
                  <span className="font-bold text-slate-900">{profiles.selected.contact_number || 'N/A'}</span>
                </div>
                <div className="flex justify-between items-center text-xs pb-1">
                  <span className="text-gray-500 font-medium">Category:</span>
                  <Badge variant="secondary" className="font-bold text-meta bg-brand-50 text-brand-600">
                    {profiles.selected.patient_type_name}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )}

          {/* HMO Coverage Info Card */}
          <Card className="border-line bg-rail text-white rounded-2xl overflow-hidden p-5 space-y-3">
            <div className="flex items-center space-x-2 text-brand-600">
              <ShieldCheck className="w-5 h-5" />
              <h3 className="font-bold text-sm text-white m-0">HMO Accreditation</h3>
            </div>
            <p className="text-rail-ink-soft text-xs leading-relaxed">
              Enlogada Clinic is partnered with accredited HMO providers like <strong>1CoopHealth</strong>. Present your HMO LOA or Approval Code during booking.
            </p>
          </Card>
        </TabsContent>
  );
}
