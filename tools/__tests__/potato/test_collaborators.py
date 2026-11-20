import copy
import secrets
import unittest

from potato.authentication import _verify_password

from collaborators import changed_roster, relative_path


class CollaboratorTests(unittest.TestCase):
    def setUp(self):
        self.config = {
            'require_password': True,
            'authentication': {'method': 'in_memory'},
            'user_config': {'allow_all_users': False, 'users': ['owner']},
            'rbac': {'user_role_assignments': {'owner': 'admin'}},
        }
        self.rows = [{'username': 'owner', 'password': secrets.token_hex(32)}]

    def test_add_retains_existing_credentials_and_admin(self):
        previous = copy.deepcopy((self.config, self.rows))
        password = secrets.token_urlsafe(24)
        config, rows = changed_roster(self.config, self.rows, 'reviewer', password)
        self.assertEqual(config['user_config']['users'], ['owner', 'reviewer'])
        self.assertEqual(config['rbac'], self.config['rbac'])
        self.assertEqual(rows[0], self.rows[0])
        self.assertTrue(_verify_password(password, rows[1]['password']))
        self.assertNotEqual(rows[1]['password'], password)
        self.assertEqual((self.config, self.rows), previous)

    def test_existing_or_reserved_account_cannot_be_overwritten(self):
        for name in ['owner', 'Owner']:
            with self.assertRaises(ValueError):
                changed_roster(self.config, self.rows, name, secrets.token_urlsafe())
        self.config['rbac']['user_role_assignments']['reserved'] = 'admin'
        with self.assertRaises(ValueError):
            changed_roster(self.config, self.rows, 'reserved', secrets.token_urlsafe())

    def test_unsafe_names_rejected(self):
        for name in ['../outside', 'a/b', '.hidden', 'x\ny', '']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                changed_roster(self.config, self.rows, name, secrets.token_urlsafe())

    def test_closed_password_auth_required(self):
        for key, value in [('require_password', False),
                           ('authentication', {'method': 'oauth'}),
                           ('user_config', {'allow_all_users': True})]:
            config = {**self.config, key: value}
            with self.assertRaises(ValueError):
                changed_roster(config, self.rows, 'reviewer', secrets.token_urlsafe())

    def test_malformed_roster_rejected(self):
        self.rows.append(self.rows[0].copy())
        with self.assertRaises(ValueError):
            changed_roster(self.config, self.rows, 'reviewer', secrets.token_urlsafe())

    def test_roster_path_stays_inside_task(self):
        self.assertEqual(relative_path('auth/users.jsonl'), 'auth/users.jsonl')
        for path in ['../users.jsonl', '/etc/passwd']:
            with self.assertRaises(ValueError):
                relative_path(path)


if __name__ == '__main__':
    unittest.main()
