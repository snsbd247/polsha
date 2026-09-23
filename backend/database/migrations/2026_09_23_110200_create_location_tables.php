<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('divisions', function (Blueprint $table) {
            $table->id();
            $table->string('name_bn');
            $table->string('name_en')->nullable();
            $table->string('code', 20)->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        $children = [
            'districts' => 'division_id',
            'upazilas' => 'district_id',
            'unions' => 'upazila_id',
            'villages' => 'union_id',
        ];
        $parents = ['division_id' => 'divisions', 'district_id' => 'districts', 'upazila_id' => 'upazilas', 'union_id' => 'unions'];

        foreach ($children as $name => $parentKey) {
            Schema::create($name, function (Blueprint $table) use ($parentKey, $parents) {
                $table->id();
                $table->foreignId($parentKey)->constrained($parents[$parentKey]);
                $table->string('name_bn');
                $table->string('name_en')->nullable();
                $table->string('code', 20)->nullable();
                $table->boolean('is_active')->default(true);
                $table->timestamps();
                $table->index([$parentKey, 'name_bn']);
            });
        }

        Schema::create('mouzas', function (Blueprint $table) {
            $table->id();
            $table->foreignId('union_id')->constrained();
            // Denormalised so JL number can be unique per upazila.
            $table->foreignId('upazila_id')->constrained();
            $table->string('name_bn');
            $table->string('name_en')->nullable();
            $table->string('jl_no', 20);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['upazila_id', 'jl_no']);
        });

        Schema::create('mouza_village', function (Blueprint $table) {
            $table->foreignId('mouza_id')->constrained()->cascadeOnDelete();
            $table->foreignId('village_id')->constrained()->cascadeOnDelete();
            $table->primary(['mouza_id', 'village_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mouza_village');
        Schema::dropIfExists('mouzas');
        foreach (['villages', 'unions', 'upazilas', 'districts', 'divisions'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
