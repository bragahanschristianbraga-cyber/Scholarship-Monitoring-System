# Student Scholarship Monitoring System

A web-based system for tracking scholars, collecting grade submissions, verifying them, and evaluating academic compliance against each scholarship program's rules. Built with vanilla JavaScript and Supabase (PostgreSQL, Auth, Row Level Security).

## Features

- **Role-based access** for four roles: Administrator, Coordinator, Staff, and Scholar
- **Scholar management**: register, edit, search, and filter scholar records
- **Scholarship programs**: configure required GWA, minimum units, and failing-grade policy
- **Grade submissions**: scholars (or staff) submit grades per academic year and semester
- **Verification workflow**: staff verify pending submissions
- **Compliance evaluation**: the coordinator evaluates verified submissions; deficiencies are recorded automatically
- **Dashboard**: totals for scholars, pending and verified submissions, and compliance results
- **Audit log**: verification and evaluation actions are recorded

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, vanilla JavaScript (ES modules) |
| Backend | Supabase (PostgreSQL, Auth, RPC functions) |
| Security | Row Level Security (RLS) policies |
| Hosting | GitHub Pages (or any static host) |

## Roles and Permissions

| Action | Admin | Coordinator | Staff | Scholar |
|---|:-:|:-:|:-:|:-:|
| View dashboard | ✔ | ✔ | ✔ | |
| Register / edit scholars | ✔ | | ✔ | |
| Manage scholarship programs | ✔ | ✔ | | |
| Submit grades | ✔ | | ✔ | Own only |
| Verify grade submissions | ✔ | | ✔ | |
| Evaluate compliance | ✔ | ✔ | | |
| View own status and deficiencies | | | | ✔ |

## Workflow

1. A scholar (or staff) submits grades. The submission is saved as **Pending** and the scholar becomes **For Verification**.
2. Staff **verify** the submission.
3. The coordinator **evaluates** it. The result is **Compliant** or **With Deficiency**, with notes explaining any failed requirement.

Compliance rules checked: GWA at or below the program limit (1.00 is highest), minimum enrolled units, failing-grade policy, and no incomplete subjects.

## Database

Main tables: `profiles`, `scholarship_programs`, `scholars`, `grade_submissions`, `audit_log`.

- `profiles.id` → `auth.users.id` (one to one)
- `scholars.scholarship_id` → `scholarship_programs.id` (many to one)
- `scholars.user_id` → `auth.users.id` (optional link to a login)
- `grade_submissions.scholar_id` → `scholars.id` (many to one)
- `grade_submissions.verified_by` → `auth.users.id`

Server-side functions: `verify_submission()` and `evaluate_compliance()`, plus role helpers `is_admin()`, `is_staff_or_admin()`, and `is_coordinator_or_admin()`.

## Setup

### 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** and run the full database script (tables, functions, triggers, RLS policies, sample data).

### 2. Create user accounts

Go to **Authentication → Users → Add user → Create new user**, tick **Auto Confirm User**, and create the demo accounts:

| Role | Email | Password |
|---|---|---|
| Admin | admin@scholarship.local | Admin@12345 |
| Coordinator | coordinator@scholarship.local | Coord@12345 |
| Staff | staff@scholarship.local | Staff@12345 |
| Scholar | juan@scholarship.local | Scholar@12345 |

Then run the **role assignment** section of the script so each account gets its role, and Juan is linked to his scholar record.

> These are demo credentials for testing only. Do not use them in production.

### 3. Configure the app

Create `config.js` next to `index.html`:

```js
export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';
```

Use the **anon / public** key from **Project Settings → API**. Never use the `service_role` key in frontend code.

### 4. Run it

The app uses ES modules, so it must be served over HTTP (opening the file directly will not work).

- **VS Code:** right-click `index.html` → *Open with Live Server*
- **GitHub Pages:** push the repo, then enable Pages under **Settings → Pages**

## Project Structure

```
├── index.html     # Login screen and app layout
├── app.js         # Auth, role checks, views, Supabase calls
├── styles.css     # Styling
├── config.js      # Supabase URL and anon key (you create this)
└── database.sql   # Schema, RLS policies, functions, sample data
```

## Troubleshooting

| Problem | Fix |
|---|---|
| "Invalid login credentials" | The user doesn't exist or the password differs. Recreate it in Authentication → Users. |
| Too many requests (429) | Supabase is rate limiting. Wait about 10 minutes before retrying. |
| Login form stays on screen | Make sure `styles.css` includes `[hidden]{display:none !important}`. |
| `is_staff_or_admin() does not exist` | Run the role helper functions section of the SQL script. |
| Scholar sees "account not linked" | Set `scholars.user_id` to that user's ID. |

## License

For academic use.
