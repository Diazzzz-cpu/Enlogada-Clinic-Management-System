// The staff shell App mounts once per session [1.128.0], as its own module so App can fetch it
// on first use like every other staff screen [1.87.0] and Home stays light.
export { StaffShellHost as default } from './SidebarLayout';
