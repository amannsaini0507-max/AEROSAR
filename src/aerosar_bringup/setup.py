import os
from glob import glob
from setuptools import find_packages, setup

package_name = 'aerosar_bringup'

setup(
    name=package_name,
    version='1.0.0',
    packages=find_packages(),
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        ('share/' + package_name + '/launch', glob('launch/*.py')),
        ('share/' + package_name + '/scripts', glob('scripts/*')),
        ('lib/' + package_name, glob('scripts/*')),
    ],
    scripts=glob('scripts/*'),
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='Member 1 (Drone Sim & ROS 2 Lead)',
    maintainer_email='amann.saini.0507@gmail.com',
    description='Master system bringup package for AEROSAR Search and Rescue drone platform',
    license='Apache-2.0',
    entry_points={
        'console_scripts': [
        ],
    },
)
