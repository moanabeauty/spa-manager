import { redirect } from "next/navigation";

// "Lịch của tôi" nay nằm trong trang Tài khoản của tôi
export default function OldMyAppointments() {
  redirect("/tai-khoan");
}
