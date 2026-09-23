<?php

namespace Database\Seeders;

use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        AuditLogger::$enabled = false;
        $this->call([RolePermissionSeeder::class, LocationSeeder::class, SystemSeeder::class]);

        if (! User::where('username', 'admin')->exists()) {
            $admin = User::create([
                'name_bn' => 'সুপার অ্যাডমিন',
                'name_en' => 'Super Admin',
                'username' => 'admin',
                'mobile' => env('ADMIN_MOBILE', '01700000000'),
                'password' => env('ADMIN_PASSWORD', 'admin12345'),
                'must_change_password' => true,
            ]);
            $admin->assignRole('super_admin');
        }
        AuditLogger::$enabled = true;
    }
}
