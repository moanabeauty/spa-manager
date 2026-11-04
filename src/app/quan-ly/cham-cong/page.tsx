import PayrollScreen from "../bang-luong/screen";

export const metadata = { title: "Chấm công – Moana Beauty" };

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ thang?: string }> }) {
  const sp = await searchParams;
  return <PayrollScreen mode="cham-cong" thang={sp.thang} />;
}
