'use client';

import { useState } from 'react';
import type { TabProps } from './page-scheduler-hub';
import FbProfilesCard from './fb-profiles-card';
import PagesTable from './pages-table';
import DefaultCountriesCard from './default-countries-card';

export default function SettingsTab({ role }: TabProps) {
  // Bumped whenever profiles change so the pages table refetches.
  const [pagesVersion, setPagesVersion] = useState(0);

  return (
    <div className="space-y-6">
      <FbProfilesCard onChanged={() => setPagesVersion((v) => v + 1)} />
      <PagesTable role={role} version={pagesVersion} />
      <DefaultCountriesCard />
    </div>
  );
}
