export type Permission = 'reports:read' | 'contacts:write' | 'settings:read';
const grants: Record<Permission, readonly string[]> = {
  'reports:read': ['admin', 'operator', 'viewer'],
  'contacts:write': ['admin', 'operator'],
  'settings:read': ['admin'],
};
export function can(roles: readonly string[], permission: Permission): boolean {
  return roles.some(role => grants[permission].includes(role));
}
