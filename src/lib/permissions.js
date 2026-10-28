// Mirrors firestore.rules. Frontend checks are UX only; the rules enforce access server-side.
export const ROLES = ['admin', 'accountant', 'data_entry', 'viewer'];
const MATRIX = {
  admin: { read: true, create: true, update: true, delete: true, manageUsers: true, finalizeSettlement: true, voidFinancial: true },
  accountant: { read: true, create: true, update: true, delete: false, manageUsers: false, finalizeSettlement: false, voidFinancial: true },
  data_entry: { read: true, create: true, update: false, delete: false, manageUsers: false, finalizeSettlement: false, voidFinancial: false },
  viewer: { read: true, create: false, update: false, delete: false, manageUsers: false, finalizeSettlement: false, voidFinancial: false },
};
export const can = (role, action) => !!MATRIX[role]?.[action];
