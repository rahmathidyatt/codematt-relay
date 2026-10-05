export type Permission = 'reports:read' | 'contacts:write' | 'settings:read' | 'campaigns:write' | 'templates:sync';
const grants: Record<Permission, readonly string[]> = {
  'reports:read': ['admin', 'operator', 'viewer'],
  'contacts:write': ['admin', 'operator'],
  'campaigns:write': ['admin', 'operator'],
  'templates:sync': ['admin'],
  'settings:read': ['admin'],
};
export function can(roles: readonly string[], permission: Permission): boolean {
  return roles.some(role => grants[permission].includes(role));
}
